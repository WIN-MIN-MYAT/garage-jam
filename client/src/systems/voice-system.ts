import { createSystem } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';

export class VoiceSystem extends createSystem({}) {
  private recognition: any = null;
  private listening = false;

  init() {
    const start = () => this.start();
    garageEvents.addEventListener('voice-start', start);
    this.cleanupFuncs.push(() => garageEvents.removeEventListener('voice-start', start));
    if (location.hostname === 'localhost') {
      (window as any).garageVoiceDebug = { start: () => this.start(), get listening() { return system.listening; } };
      const system = this;
    }
  }

  private start() {
    if (this.listening) return;
    const Recognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      emit('status', 'Voice capture is not available in this browser. Add tasks from a paper or the phone pairing page.');
      return;
    }
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => { this.listening = true; emit('status', 'Listening... say “add task” and a title'); emit('voice-state', { listening: true }); };
    recognition.onerror = (event: any) => {
      this.listening = false;
      emit('status', event.error === 'not-allowed' ? 'Microphone permission was denied.' : `Voice capture failed: ${event.error}`);
      emit('voice-state', { listening: false });
    };
    recognition.onend = () => { this.listening = false; emit('voice-state', { listening: false }); };
    recognition.onresult = (event: any) => {
      const text = String(event.results?.[0]?.[0]?.transcript ?? '').trim();
      if (!text) return;
      const title = text.replace(/^(add|create)\s+(a\s+)?task[:\s-]*/i, '').trim();
      if (!title) { emit('status', 'I heard you, but there was no task title.'); return; }
      void this.create(title);
    };
    this.recognition = recognition;
    try { recognition.start(); } catch { this.listening = false; }
  }

  private async create(title: string) {
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.slice(0, 200), target: 'local' }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const task = await response.json();
      emit('task-created', task);
      emit('status', `Task added: ${task.title}`);
    } catch (error) {
      emit('status', `Could not add task: ${(error as Error).message}`);
    }
  }
}
