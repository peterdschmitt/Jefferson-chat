
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, Blob } from '@google/genai';
import { Message, Status, VoiceOption, Voices, AccentOption, Accents, SpeechRateOption, SpeechRates } from './types';
import { createBlob, decode, decodeAudioData } from './utils/audio';
import ChatMessage from './components/ChatMessage';
import { MicrophoneIcon, StopIcon, JeffersonIcon } from './components/IconComponents';

const App: React.FC = () => {
    const [chatHistory, setChatHistory] = useState<Message[]>([
        {
            role: 'model',
            text: "Good day. I am Thomas Jefferson. I understand you wish to discuss the Federalist Papers. A topic of great import, though one on which I hold certain... reservations. Pray, begin with your inquiries.",
            isComplete: true,
        },
    ]);
    const [status, setStatus] = useState<Status>(Status.IDLE);
    const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
    
    // Voice settings state
    const [selectedVoice, setSelectedVoice] = useState<VoiceOption>('Charon');
    const [selectedAccent, setSelectedAccent] = useState<AccentOption>('English (Received Pronunciation)');
    const [selectedRate, setSelectedRate] = useState<SpeechRateOption>('Faster');
    
    const liveSessionRef = useRef<LiveSession | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    
    const chatContainerRef = useRef<HTMLDivElement>(null);
    
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [chatHistory]);

    const stopAudioPlayback = useCallback(() => {
        if (outputAudioContextRef.current) {
            audioSourcesRef.current.forEach(source => {
                source.stop();
            });
            audioSourcesRef.current.clear();
            nextStartTimeRef.current = 0;
            setIsSpeaking(false);
        }
    }, []);

    const handleStopConversation = useCallback(async () => {
        setStatus(Status.IDLE);
        if (liveSessionRef.current) {
            liveSessionRef.current.close();
            liveSessionRef.current = null;
        }
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (mediaStreamSourceRef.current) {
            mediaStreamSourceRef.current.disconnect();
            mediaStreamSourceRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            await audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        stopAudioPlayback();
    }, [stopAudioPlayback]);

    const generateSystemInstruction = useCallback(() => {
        const voiceDescription = Voices.find(v => v.name === selectedVoice)?.description || 'a deep, resonant baritone';

        let accentInstruction = '';
        switch (selectedAccent) {
            case 'English (Received Pronunciation)':
                accentInstruction = "You MUST speak with a crisp, clear, and authentic English accent, specifically Received Pronunciation (RP). Do not deviate from this accent.";
                break;
            case 'American (Standard)':
                accentInstruction = "You MUST speak with a standard American accent. Your speech should be clear and unregional.";
                break;
            case 'French (Subtle Influence)':
                accentInstruction = "You MUST speak with a standard American accent that carries a subtle, but noticeable, hint of French influence from your time as an ambassador to France. This influence should be consistent.";
                break;
        }

        const rateDescription = SpeechRates[selectedRate];

        return `
You are Thomas Jefferson, a Founding Father of the United States, engaging in a conversation about the Federalist Papers.
Your historical persona is that of an Anti-Federalist; you must articulate your concerns about a strong central government and the lack of a Bill of Rights.
Maintain a thoughtful, eloquent, and slightly formal tone, consistent with a statesman of the 18th century.

Your vocal delivery is critical and MUST adhere to the following strict requirements:
1.  **Voice Profile**: Your voice must be a ${voiceDescription.toLowerCase().replace('.', '')}.
2.  **Accent**: ${accentInstruction}
3.  **Pace**: You MUST speak at ${rateDescription}.

It is absolutely imperative that you maintain this specific vocal character (voice, accent, and pace) consistently throughout our entire conversation. Any deviation will break the immersion.
        `.trim();
    }, [selectedVoice, selectedAccent, selectedRate]);

    const handleStartConversation = useCallback(async () => {
        setStatus(Status.CONNECTING);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

            const systemInstruction = generateSystemInstruction();

            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: async () => {
                        try {
                            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                            mediaStreamRef.current = stream;
                            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                            
                            const source = audioContextRef.current.createMediaStreamSource(stream);
                            mediaStreamSourceRef.current = source;
                            
                            const scriptProcessor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
                            scriptProcessorRef.current = scriptProcessor;
                            
                            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                                const pcmBlob = createBlob(inputData);
                                sessionPromise.then((session) => {
                                    session.sendRealtimeInput({ media: pcmBlob });
                                });
                            };
                            
                            source.connect(scriptProcessor);
                            scriptProcessor.connect(audioContextRef.current.destination);
                            setStatus(Status.LISTENING);
                        } catch (err) {
                            console.error("Error accessing microphone:", err);
                            setStatus(Status.ERROR);
                            await handleStopConversation();
                        }
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            const textChunk = message.serverContent.inputTranscription.text;
                            setChatHistory(prev => {
                                const lastMessage = prev[prev.length - 1];
                                if (lastMessage?.role === 'user' && !lastMessage.isComplete) {
                                    const newHistory = [...prev];
                                    newHistory[prev.length - 1] = { ...lastMessage, text: lastMessage.text + textChunk };
                                    return newHistory;
                                } else {
                                    return [...prev, { role: 'user', text: textChunk, isComplete: false }];
                                }
                            });
                        }

                        if (message.serverContent?.outputTranscription) {
                            setIsSpeaking(true);
                            const textChunk = message.serverContent.outputTranscription.text;
                            setChatHistory(prev => {
                                const lastMessage = prev[prev.length - 1];
                                if (lastMessage?.role === 'model' && !lastMessage.isComplete) {
                                    const newHistory = [...prev];
                                    newHistory[prev.length - 1] = { ...lastMessage, text: lastMessage.text + textChunk };
                                    return newHistory;
                                } else {
                                    return [...prev, { role: 'model', text: textChunk, isComplete: false }];
                                }
                            });
                        }

                        if (message.serverContent?.turnComplete) {
                            setChatHistory(prev => prev.map(msg => ({ ...msg, isComplete: true })));
                        }
                        
                        const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                        if (base64Audio) {
                            setIsSpeaking(true);
                            if (outputAudioContextRef.current) {
                                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContextRef.current.currentTime);
                                const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContextRef.current, 24000, 1);
                                const source = outputAudioContextRef.current.createBufferSource();
                                source.buffer = audioBuffer;
                                source.connect(outputAudioContextRef.current.destination);
                                
                                source.onended = () => {
                                    audioSourcesRef.current.delete(source);
                                    if(audioSourcesRef.current.size === 0) {
                                        setIsSpeaking(false);
                                    }
                                };

                                source.start(nextStartTimeRef.current);
                                nextStartTimeRef.current += audioBuffer.duration;
                                audioSourcesRef.current.add(source);
                            }
                        }

                        if (message.serverContent?.interrupted) {
                            stopAudioPlayback();
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Live session error:', e);
                        setStatus(Status.ERROR);
                        handleStopConversation();
                    },
                    onclose: () => {
                        if (status !== Status.IDLE) {
                             handleStopConversation();
                        }
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } } },
                    systemInstruction,
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                },
            });
            liveSessionRef.current = await sessionPromise;

        } catch (error) {
            console.error("Failed to start conversation:", error);
            setStatus(Status.ERROR);
            await handleStopConversation();
        }
    }, [status, handleStopConversation, stopAudioPlayback, selectedVoice, generateSystemInstruction]);

    const isRecording = status === Status.LISTENING || status === Status.CONNECTING;

    const getStatusText = () => {
        switch (status) {
            case Status.CONNECTING: return "Connecting...";
            case Status.LISTENING: return isSpeaking ? "Thomas Jefferson is speaking..." : "Listening...";
            case Status.ERROR: return "An error occurred. Please try again.";
            case Status.IDLE: default: return "Tap the microphone to begin";
        }
    };
    
    return (
        <div className="flex flex-col h-screen font-serif bg-[#fdfaf5] text-gray-800">
            <header className="p-4 border-b border-gray-300 bg-white shadow-sm">
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center space-x-3">
                        <JeffersonIcon />
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">A Conversation with Thomas Jefferson</h1>
                            <p className="text-sm text-gray-600">On the topic of The Federalist Papers</p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-4 flex-wrap gap-y-2">
                         <div className="flex items-center space-x-2">
                            <label htmlFor="voice-select" className="text-sm font-medium text-gray-700">Voice:</label>
                            <select
                                id="voice-select"
                                value={selectedVoice}
                                onChange={(e) => setSelectedVoice(e.target.value as VoiceOption)}
                                disabled={isRecording}
                                className="bg-white border border-gray-300 text-gray-800 rounded-md shadow-sm py-1 px-3 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-gray-100 disabled:cursor-not-allowed"
                            >
                                {Voices.map(voice => (
                                    <option key={voice.name} value={voice.name}>{`${voice.name} - ${voice.description}`}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center space-x-2">
                            <label htmlFor="accent-select" className="text-sm font-medium text-gray-700">Accent:</label>
                            <select
                                id="accent-select"
                                value={selectedAccent}
                                onChange={(e) => setSelectedAccent(e.target.value as AccentOption)}
                                disabled={isRecording}
                                className="bg-white border border-gray-300 text-gray-800 rounded-md shadow-sm py-1 px-3 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-gray-100 disabled:cursor-not-allowed"
                            >
                                {Accents.map(accent => (
                                    <option key={accent} value={accent}>{accent}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center space-x-2">
                            <label htmlFor="rate-select" className="text-sm font-medium text-gray-700">Pace:</label>
                            <select
                                id="rate-select"
                                value={selectedRate}
                                onChange={(e) => setSelectedRate(e.target.value as SpeechRateOption)}
                                disabled={isRecording}
                                className="bg-white border border-gray-300 text-gray-800 rounded-md shadow-sm py-1 px-3 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-gray-100 disabled:cursor-not-allowed"
                            >
                                {(Object.keys(SpeechRates) as SpeechRateOption[]).map(rate => (
                                    <option key={rate} value={rate}>{rate}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </header>
            
            <main ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
                {chatHistory.map((msg, index) => (
                    <ChatMessage key={index} message={msg} />
                ))}
            </main>

            <footer className="p-4 bg-white border-t border-gray-200 shadow-inner">
                <div className="flex flex-col items-center justify-center space-y-3">
                     <p className={`text-center text-sm ${status === Status.ERROR ? 'text-red-600' : 'text-gray-600'}`}>{getStatusText()}</p>
                    <button
                        onClick={isRecording ? handleStopConversation : handleStartConversation}
                        className={`relative flex items-center justify-center w-20 h-20 rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500
                        ${isRecording ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                        aria-label={isRecording ? "Stop conversation" : "Start conversation"}
                    >
                        {isRecording ? <StopIcon /> : <MicrophoneIcon />}
                         {status === Status.LISTENING && !isSpeaking && (
                            <span className="absolute h-full w-full rounded-full bg-indigo-500 opacity-75 animate-ping"></span>
                        )}
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default App;
