const mic = document.getElementById('mic');
const form = document.getElementById('task-form');
const input = document.getElementById('title');
const statusEl = document.getElementById('status');

let recognition = null;
let listening = false;

function setStatus(text, tone = '') {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

async function postTask(body) {
  return fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function addTask(title) {
  const clean = title.trim();
  if (!clean) {
    setStatus('Say or type a task title first.', 'error');
    input.focus();
    return;
  }
  setStatus('Adding…');
  try {
    // Prefer the shared Notion board, then fall back to local storage so a
    // Notion rate-limit never loses the task.
    let response = await postTask({ title: clean });
    if (!response.ok) response = await postTask({ title: clean, target: 'local' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    const task = await response.json();
    input.value = '';
    setStatus(`Added “${task.title}”${task.target === 'notion' ? ' to Notion' : ''}. It will appear in the garage shortly.`, 'ok');
    if (navigator.vibrate) navigator.vibrate(40);
  } catch (error) {
    setStatus(`Could not add task: ${error.message}`, 'error');
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  void addTask(input.value);
});

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Recognition) {
  mic.hidden = true;
  setStatus('Voice recognition is not available in this browser. Type the task below instead.');
} else {
  recognition = new Recognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    listening = true;
    mic.textContent = 'Listening…';
    mic.classList.add('live');
    setStatus('Listening… say “add task buy milk”.');
  };
  recognition.onend = () => {
    listening = false;
    mic.textContent = 'Start listening';
    mic.classList.remove('live');
  };
  recognition.onerror = event => {
    listening = false;
    mic.textContent = 'Start listening';
    mic.classList.remove('live');
    setStatus(event.error === 'not-allowed' ? 'Microphone permission was denied.' : `Voice capture failed: ${event.error}`, 'error');
  };
  recognition.onresult = event => {
    const text = String(event.results?.[0]?.[0]?.transcript ?? '').trim();
    if (!text) return;
    const title = text.replace(/^(add|create)\s+(a\s+)?task[:\s-]*/i, '').trim();
    if (!title) {
      setStatus('I heard you, but there was no task title. Try “add task …”.', 'error');
      return;
    }
    input.value = title;
    setStatus(`Heard “${title}”. Adding…`);
    void addTask(title);
  };
  mic.addEventListener('click', () => {
    if (listening) {
      recognition.stop();
      return;
    }
    try {
      recognition.start();
    } catch {
      setStatus('Could not start the microphone. Try again.', 'error');
    }
  });
}
