export interface Message {
    role: 'user' | 'model';
    text: string;
    isComplete?: boolean;
}

export enum Status {
    IDLE = 'idle',
    CONNECTING = 'connecting',
    LISTENING = 'listening',
    ERROR = 'error',
}

export const Voices = [
    { name: 'Charon', description: 'A very deep, resonant baritone.' },
    { name: 'Puck', description: 'A clear, engaging tenor.' },
    { name: 'Kore', description: 'A warm, pleasant alto.' },
    { name: 'Fenrir', description: 'A strong, commanding baritone.' },
    { name: 'Zephyr', description: 'A friendly, approachable tenor.' },
] as const;

type VoiceTuple = typeof Voices;
type VoiceObject = VoiceTuple[number];
export type VoiceOption = VoiceObject['name'];

export const Accents = [
    'English (Received Pronunciation)',
    'American (Standard)',
    'French (Subtle Influence)',
] as const;
export type AccentOption = typeof Accents[number];

export const SpeechRates = {
    Slower: 'a deliberate, measured pace',
    Normal: 'a standard conversational pace',
    Faster: 'a notably brisk pace, conveying intellectual urgency',
};
export type SpeechRateOption = keyof typeof SpeechRates;
