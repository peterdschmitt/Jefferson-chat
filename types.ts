
export interface Message {
    role: 'user' | 'model';
    text: string;
}

export enum Status {
    IDLE = 'idle',
    CONNECTING = 'connecting',
    LISTENING = 'listening',
    ERROR = 'error',
}
