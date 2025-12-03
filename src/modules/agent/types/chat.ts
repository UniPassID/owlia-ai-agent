export interface Message {
  id: string;
  content: string;
  timestamp: Date;
  type?: 'info' | 'success' | 'warning' | 'action';
  icon?: any;
  messageType: 'simple';
}

export interface TimelineStep {
  id: string;
  content: string;
  status: 'pending' | 'processing' | 'success' | 'error' | 'skipped';
  metadata?: {
    txHash?: string;
    reason?: string;
  };
}

export interface TimelineMessage {
  id: string;
  title: string;
  timestamp: Date;
  steps: TimelineStep[];
  isCompleted: boolean;
  isExpanded?: boolean;
  messageType: 'timeline';
  summary?: string;
}

export type ChatMessage = Message | TimelineMessage;

export interface GuideMessage {
  content: string;
  type?: 'info' | 'success' | 'warning' | 'action';
  delay: number; // ms delay before showing this message
  icon?: any;
}
