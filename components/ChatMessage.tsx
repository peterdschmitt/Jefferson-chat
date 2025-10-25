
import React from 'react';
import { Message } from '../types';
import { JeffersonIcon, UserIcon } from './IconComponents';

interface ChatMessageProps {
  message: Message;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isModel = message.role === 'model';

  return (
    <div className={`flex items-start gap-3 md:gap-4 ${isModel ? '' : 'justify-end'}`}>
      {isModel && (
        <div className="flex-shrink-0">
          <JeffersonIcon />
        </div>
      )}
      <div
        className={`max-w-xl rounded-xl px-4 py-3 shadow-md ${
          isModel
            ? 'bg-white text-gray-800 border border-gray-200'
            : 'bg-indigo-500 text-white'
        }`}
      >
         {isModel && (
            <p className="font-bold text-sm mb-1 text-gray-700">Thomas Jefferson</p>
         )}
        <p className="text-base leading-relaxed whitespace-pre-wrap">{message.text}</p>
      </div>
       {!isModel && (
        <div className="flex-shrink-0">
          <UserIcon />
        </div>
      )}
    </div>
  );
};

export default ChatMessage;
