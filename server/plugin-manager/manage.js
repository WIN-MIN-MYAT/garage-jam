const prefix = '/api/plugins';
const labels = { notion: 'Notion', spotify: 'Spotify', calendar: 'Google Calendar', weather: 'Weather' };
const notice = document.querySelector('#notice');
const locations = document.querySelector('#locations');
const query = new URLSearchParams(location.search);

async function request(path, method = 'GET', body) {
  const response = await fetch(prefix + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Connection request failed.');
  return data;
}

function notify(text) {
  notice.textContent = text;
  notice.hidden = !text;
}

const control = (id, action) => document.querySelector(`[data-provider="${id}"][data-action="${action}"]`);

function render(id, status) {
  const state = document.querySelector(`#${id}-state`);
  const offOrigin = status.origin && status.origin !== location.origin;
  if (status.connected) {
    const verified = new Date(status.verifiedAt).toLocaleString();
    const sample = status.sample;
    state.textContent = sample
      ? `${status.account} · ${sample.temperature} ${sample.unit} at ${sample.localTime.replace('T', ' ')} local time. Checked ${verified}.`
      : `Connected to ${status.account}. Last verified ${verified}.`;
  } else if (!status.configured) {
    state.textContent = 'Provider setup is required on the server.';
  } else {
    state.textContent = id === 'weather' ? 'Choose a location to connect.' : 'Ready to connect.';
  }
  const connect = control(id, 'connect');
  if (connect) {
    connect.hidden = !status.configured || !!offOrigin;
    connect.textContent = `${status.connected ? 'Reconnect' : 'Connect'} ${labels[id]}`;
    const setup = document.querySelector(`[data-setup-link="${id}"]`);
    setup.hidden = !offOrigin;
    if (offOrigin) setup.href = new URL(`${prefix}/manage?provider=${id}`, status.origin);
  }
  control(id, 'verify').hidden = !status.connected || !status.configured;
  control(id, 'remove').hidden = !status.connected;
}

async function load() {
  const status = await request('/status');
  for (const id of Object.keys(labels)) render(id, status[id]);
}

async function perform(button, operation) {
  const controls = [...button.closest('section').querySelectorAll('button, input')];
  for (const control of controls) control.disabled = true;
  notify('');
  try {
    await operation();
  } catch (error) {
    notify(error.message);
  } finally {
    for (const control of controls) control.disabled = false;
  }
}

for (const button of document.querySelectorAll('[data-action]')) {
  const { action, provider: id } = button.dataset;
  button.addEventListener('click', () => void perform(button, async () => {
    if (action === 'connect') {
      const { url } = await request(`/${id}/authorize`, 'POST');
      location.assign(url);
    } else if (action === 'verify') {
      render(id, await request(`/${id}/verify`, 'POST'));
      notify(`${labels[id]} responded successfully.`);
    } else if (action === 'remove') {
      await request(`/${id}`, 'DELETE');
      await load();
      notify(`${labels[id]} disconnected from this browser.`);
    }
  }));
}

const search = document.querySelector('#weather-search');
search.addEventListener('submit', event => {
  event.preventDefault();
  const city = new FormData(search).get('city').trim();
  void perform(search, async () => {
    locations.replaceChildren();
    const results = await request(`/weather/locations?${new URLSearchParams({ name: city })}`);
    if (!results.length) notify('No matching locations. Try adding the country or region.');
    for (const result of results) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = result.name;
      button.addEventListener('click', () => void perform(button, async () => {
        render('weather', await request('/weather/connect', 'POST', result));
        locations.replaceChildren();
        notify('Weather connected and verified.');
      }));
      locations.append(button);
    }
  });
});

const id = query.get('provider');
if (Object.hasOwn(labels, id)) {
  document.getElementById(id).focus();
  const result = query.get('result');
  const status = {
    connected: `${labels[id]} connected and verified.`,
    denied: `${labels[id]} authorization was canceled or denied.`,
    expired: 'This sign-in request expired. Choose Connect to start again.',
    unavailable: 'The connection could not be saved or verified. Try again.',
    'provider-rejected': `${labels[id]} did not return a valid connection. Try connecting again.`,
  };
  if (Object.hasOwn(status, result)) notify(status[result]);
  else if (/^provider-\d{3}$/.test(result)) notify(`${labels[id]} rejected the connection (HTTP ${result.slice(9)}). Check your provider app settings and account access.`);
  if (result) history.replaceState(null, '', `${prefix}/manage?provider=${id}`);
}

load().catch(() => {
  for (const id of Object.keys(labels)) document.querySelector(`#${id}-state`).textContent = 'Connection status unavailable.';
  notify('Could not load plugins. Reload this page to try again.');
});
