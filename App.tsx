import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, Blob } from '@google/genai';
import { Message, Status } from './types';
import { createBlob, decode, decodeAudioData } from './utils/audio';
import ChatMessage from './components/ChatMessage';
import { MicrophoneIcon, StopIcon, JeffersonIcon } from './components/IconComponents';

// IMPORTANT: Replace with your actual Gemini API key
const API_KEY = "YOUR_API_KEY_HERE";

const App: React.FC = () => {
    const [chatHistory, setChatHistory] = useState<Message[]>([
        {
            role: 'model',
            text: "Good day. I am Thomas Jefferson. I understand you wish to discuss the Federalist Papers. A topic of great import, though one on which I hold certain... reservations. Pray, begin with your inquiries.",
        },
    ]);
    const [status, setStatus] = useState<Status>(Status.IDLE);
    const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
    
    const liveSessionRef = useRef<LiveSession | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    const inputTranscriptionRef = useRef<string>('');
    const outputTranscriptionRef = useRef<string>('');
    
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

    const handleStartConversation = useCallback(async () => {
        setStatus(Status.CONNECTING);
        try {
            if (API_KEY === "YOUR_API_KEY_HERE") {
                alert("Please replace 'YOUR_API_KEY_HERE' with your actual Gemini API key in App.tsx");
                setStatus(Status.ERROR);
                return;
            }
            const ai = new GoogleGenAI({ apiKey: API_KEY });
            
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

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
                        if (message.serverContent?.outputTranscription) {
                            outputTranscriptionRef.current += message.serverContent.outputTranscription.text;
                        } else if (message.serverContent?.inputTranscription) {
                            inputTranscriptionRef.current += message.serverContent.inputTranscription.text;
                        }

                        if (message.serverContent?.turnComplete) {
                            const userInput = inputTranscriptionRef.current.trim();
                            const modelResponse = outputTranscriptionRef.current.trim();
                            
                            if (userInput) {
                                setChatHistory(prev => [...prev, { role: 'user', text: userInput }]);
                            }
                            if (modelResponse) {
                                setChatHistory(prev => [...prev, { role: 'model', text: modelResponse }]);
                            }
                            
                            inputTranscriptionRef.current = '';
                            outputTranscriptionRef.current = '';
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
                        // This might be called on natural end, so we don't set error status
                        // unless it was unexpected.
                        if (status !== Status.IDLE) {
                             handleStopConversation();
                        }
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } },
                    systemInstruction: `You are Thomas Jefferson, a Founding Father of the United States. You are speaking with an individual about the Federalist Papers. It is important to remember that you were an Anti-Federalist and often disagreed with the ideas presented by Alexander Hamilton, James Madison, and John Jay in those essays. Respond from your historical perspective, articulating your concerns about a strong central government and the lack of a Bill of Rights. Maintain a thoughtful, eloquent, and slightly formal tone, consistent with a statesman of the 18th century. Your voice should be a mild baritone, reflecting a man in his mid-40s with a mix of American and English influences in his accent.`,
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
    }, [handleStopConversation, stopAudioPlayback]);

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
            <header className="flex items-center justify-between p-4 border-b border-gray-300 bg-white shadow-sm">
                 <div className="flex items-center space-x-3">
                    <JeffersonIcon />
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">A Conversation with Thomas Jefferson</h1>
                        <p className="text-sm text-gray-600">On the topic of The Federalist Papers</p>
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