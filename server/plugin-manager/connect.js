const form = document.querySelector('#pair-form');
const notice = document.querySelector('#notice');
const input = document.querySelector('#pair-code');
const query = new URLSearchParams(location.search);
if (query.get('code')) input.value = query.get('code').toUpperCase();

function notify(text) {
  notice.textContent = text;
  notice.hidden = !text;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  notify('');
  try {
    const code = input.value.trim().toUpperCase();
    const response = await fetch('/api/plugins/pair/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Could not claim that code.');
    location.assign(data.url);
  } catch (error) {
    notify(String(error.message ?? error));
    button.disabled = false;
  }
});
