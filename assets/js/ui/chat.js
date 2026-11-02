// AI chat panel: design the job by talking to it. Shown only when the server
// has an API key (api.php?action=ai). The model's tool calls run here, on the
// open job, through the same engine code as the forms (engine/aitools.js);
// api.php only relays the conversation to the provider.
//
// The conversation is saved with the job (project.chat): `history` is the
// provider's own message list, sent back unchanged and only appended to;
// `transcript` is what the panel shows. Each request gets an Undo that puts
// the job back as it was before that request (for this session).

import { AI_TOOLS, ToolError, isMutating, layoutSummary, runTool, systemPrompt } from '../engine/aitools.js';
import { h, mount } from './dom.js';
import { setState, state, updateProject } from './store.js';

const MAX_ROUNDS = 25;
const MAX_IMAGES = 4;
const IMAGE_MAX_PX = 1568;
const THUMB_PX = 200;

/** Job snapshots (JSON, without the chat) taken before each request, by turn id. */
const snapshots = new Map();
let busy = null; // { controller } while a request runs
let draft = '';
let attachments = []; // [{ mediaType, data, thumb }]
let attachError = '';

// ---- the conversation ---------------------------------------------------------

function chatOf(p) {
  const ai = state.ai;
  // History in one provider's format can't be sent to another.
  if (!p.chat || p.chat.provider !== ai.provider) {
    const note = p.chat?.transcript?.length ? [{ role: 'note', text: `Started a new conversation: the chat now uses ${ai.provider}.` }] : [];
    p.chat = { provider: ai.provider, history: [], transcript: note, pending: [] };
  }
  p.chat.pending ??= [];
  return p.chat;
}

const editChat = (fn) => updateProject((p) => fn(chatOf(p)), { skipSettings: true });

const toolsForModel = () => AI_TOOLS.map(({ name, description, schema }) => ({ name, description, schema }));

/** Strips the chat from a job snapshot so Undo leaves the conversation alone. */
function designJson(p) {
  const { chat, ...rest } = p;
  return JSON.stringify(rest);
}

/** Posts one turn and reads the server-sent events. Resolves to { tools, stop, append } or throws. */
async function postTurn(body, onText, signal) {
  const res = await fetch('api.php?action=chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CabForge': '1' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      // not JSON
    }
    throw new Error(msg);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const tools = [];
  let done = null;
  let buffer = '';
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buffer += value.replace(/\r\n/g, '\n');
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const event = raw.match(/^event: *(.*)$/m)?.[1] ?? 'message';
      const data = raw
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('');
      if (!data) continue;
      const d = JSON.parse(data);
      if (event === 'text') onText(d.text);
      else if (event === 'tool') tools.push(d);
      else if (event === 'done') done = d;
      else if (event === 'error') throw new Error(d.message);
    }
  }
  if (!done) throw new Error('The reply stopped before it finished.');
  return { tools, ...done };
}

/** Runs a tool call on the job. A failed call leaves the job as it was. */
function runCall(call, changes) {
  if (call.invalid) return { id: call.id, content: 'The tool input was not valid JSON (the reply may have been cut off). Try again.', isError: true };
  const mutating = isMutating(call.name);
  let out;
  try {
    if (!mutating) {
      out = runTool(state.project, state.built, call.name, call.input);
    } else {
      updateProject((p) => {
        const before = designJson(p);
        try {
          out = runTool(p, state.built, call.name, call.input);
        } catch (e) {
          // Put back anything the call changed before it failed.
          const chat = p.chat;
          for (const k of Object.keys(p)) delete p[k];
          Object.assign(p, JSON.parse(before), { chat });
          throw e;
        }
      });
    }
  } catch (e) {
    if (!(e instanceof ToolError)) console.error(e);
    return { id: call.id, content: e instanceof ToolError ? e.message : `The tool failed: ${e.message}`, isError: true };
  }
  if (out.change) changes.push(out.change);
  return { id: call.id, content: out.result, isError: false };
}

async function send() {
  const text = draft.trim();
  if (busy || (!text && !attachments.length)) return;
  const turnId = `t${Date.now().toString(36)}`;
  const images = attachments;
  snapshots.set(turnId, designJson(state.project));
  draft = '';
  // mount() keeps a focused field's unsent typing across re-renders; empty
  // the box itself so the sent text doesn't come back.
  const box = document.querySelector('[data-key="chat-input"]');
  if (box) {
    box.value = '';
    delete box.dataset.dirty;
  }
  attachments = [];
  attachError = '';
  const controller = new AbortController();
  busy = { controller };
  setState({});

  let reply = null;
  editChat((chat) => {
    chat.transcript.push({ role: 'user', text, thumbs: images.map((i) => i.thumb) });
    reply = { role: 'assistant', id: turnId, text: '', changes: [], working: true };
    chat.transcript.push(reply);
  });
  const entry = () => state.project.chat.transcript.find((t) => t.id === turnId);

  // Results the model is still owed from a stopped request go first.
  const owed = state.project.chat.pending;
  const undone = state.project.chat.undoNote ? '(I undid the changes from your previous request.)\n\n' : '';
  let input = {
    text: `${undone}${text || '(see the attached image)'}\n\n<layout>\n${layoutSummary(state.project, state.built)}\n</layout>`,
    images: images.map(({ mediaType, data }) => ({ mediaType, data })),
    toolResults: owed,
  };
  try {
    for (let round = 0; ; round++) {
      if (round >= MAX_ROUNDS) throw new Error(`Stopped after ${MAX_ROUNDS} steps.`);
      let streamed = '';
      const turn = await postTurn(
        { system: systemPrompt(), tools: toolsForModel(), history: state.project.chat.history, input },
        (t) => {
          streamed += t;
          const e = entry();
          if (e) {
            e.live = streamed;
            renderLive();
          }
        },
        controller.signal,
      );
      const changes = [];
      const results = turn.tools.map((call) => runCall(call, changes));
      editChat((chat) => {
        chat.history.push(...turn.append);
        // Delivered with this turn; the new results are owed until the next one.
        chat.pending = results;
        delete chat.undoNote;
        const e = chat.transcript.find((t) => t.id === turnId);
        if (streamed) e.text = e.text ? `${e.text}\n\n${streamed}` : streamed;
        delete e.live;
        e.changes.push(...changes);
        if (turn.stop === 'max_tokens') e.note = 'The reply hit the length limit.';
        if (turn.stop === 'refusal') e.note = 'The model declined this request.';
      });
      // Every tool call must be answered, so a reply with calls always loops.
      if (!results.length) break;
      if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      input = { toolResults: results };
    }
  } catch (e) {
    editChat((chat) => {
      const t = chat.transcript.find((t) => t.id === turnId);
      if (t) {
        delete t.live;
        t.error = e.name === 'AbortError' ? 'Stopped.' : e.message;
      }
    });
  } finally {
    busy = null;
    editChat((chat) => {
      const t = chat.transcript.find((t) => t.id === turnId);
      if (t) delete t.working;
    });
  }
}

function undo(turnId) {
  const snap = snapshots.get(turnId);
  if (!snap) return;
  updateProject((p) => {
    const chat = p.chat;
    for (const k of Object.keys(p)) delete p[k];
    Object.assign(p, JSON.parse(snap), { chat });
    const t = chat.transcript.find((t) => t.id === turnId);
    if (t) t.undone = true;
    // Tell the model on the next request.
    chat.undoNote = true;
  });
  snapshots.delete(turnId);
}

function clearChat() {
  if (busy) return;
  if (!confirm('Clear this conversation? The job stays as it is.')) return;
  snapshots.clear();
  editChat((chat) => {
    chat.history = [];
    chat.transcript = [];
    chat.pending = [];
    delete chat.undoNote;
  });
}

// ---- images ---------------------------------------------------------------------

/** Scales an image file down to fit `max` px and returns a JPEG data URL. */
async function shrink(file, max, quality) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}

async function attach(files) {
  attachError = '';
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    if (attachments.length >= MAX_IMAGES) {
      attachError = `Up to ${MAX_IMAGES} images per message.`;
      break;
    }
    try {
      const full = await shrink(file, IMAGE_MAX_PX, 0.85);
      attachments.push({ mediaType: 'image/jpeg', data: full.split(',')[1], thumb: await shrink(file, THUMB_PX, 0.7) });
    } catch {
      attachError = `${file.name} could not be read as an image.`;
    }
  }
  setState({});
}

// ---- rendering ---------------------------------------------------------------------

let liveTarget = null;

/** Updates the streaming reply in place, without a full re-render. */
function renderLive() {
  const t = state.project.chat?.transcript.find((t) => t.live != null);
  if (liveTarget && t) {
    liveTarget.textContent = t.live;
    liveTarget.closest('.chat-log')?.scrollTo({ top: 1e9 });
  }
}

function message(t) {
  if (t.role === 'note') return h('div', { class: 'chat-note' }, t.text);
  if (t.role === 'user') {
    return h(
      'div',
      { class: 'chat-msg user' },
      t.thumbs?.length ? h('div', { class: 'chat-thumbs' }, t.thumbs.map((src) => h('img', { src, alt: 'Attached image' }))) : null,
      t.text ? h('div', { class: 'chat-text' }, t.text) : null,
    );
  }
  const live = t.live != null ? h('div', { class: 'chat-text' }, t.live) : null;
  if (live) liveTarget = live;
  return h(
    'div',
    { class: `chat-msg assistant${t.undone ? ' undone' : ''}` },
    t.text ? h('div', { class: 'chat-text' }, t.text) : null,
    live,
    t.working && !t.live && !t.text ? h('div', { class: 'chat-text muted' }, 'Thinking…') : null,
    t.changes?.length
      ? h(
          'div',
          { class: 'chat-changes' },
          h('ul', {}, t.changes.map((c) => h('li', {}, c))),
          t.undone
            ? h('span', { class: 'muted' }, 'Undone')
            : snapshots.has(t.id) && !t.working
              ? h('button', { onclick: () => undo(t.id), title: 'Put the job back as it was before this request' }, 'Undo')
              : null,
        )
      : null,
    t.note ? h('div', { class: 'chat-note' }, t.note) : null,
    t.error ? h('div', { class: 'error' }, t.error) : null,
  );
}

export function renderChat(container) {
  if (!state.chatOpen || !state.ai?.enabled || !state.project) {
    container.replaceChildren();
    return;
  }
  const chat = state.project.chat?.provider === state.ai.provider ? state.project.chat : { transcript: [] };
  liveTarget = null;
  const input = h('textarea', {
    'data-key': 'chat-input',
    rows: 3,
    placeholder: busy ? 'Working…' : 'Describe what to build or change, e.g. "Add a 36" sink base on wall 1 with a dishwasher to its right"',
    value: draft,
    oninput: (e) => (draft = e.target.value),
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    },
    onpaste: (e) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        attach(files);
      }
    },
  });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => attach([...e.target.files]) });
  const log = h(
    'div',
    { class: 'chat-log' },
    chat.transcript.length
      ? chat.transcript.map(message)
      : h(
          'div',
          { class: 'chat-empty muted' },
          h('p', {}, 'Ask for a layout or a change, and it is made in the open job. Each request can be undone.'),
          h('p', {}, 'Try: "L-shaped kitchen, 12\' and 9\' walls, sink centred on the long wall, range on the short one." You can attach a photo or sketch.'),
        ),
  );
  mount(
    container,
    h(
      'aside',
      { class: 'chat-panel', 'aria-label': 'AI chat' },
      h(
        'header',
        { class: 'chat-head' },
        h('strong', {}, 'AI chat'),
        h('span', { class: 'muted', title: `${state.ai.provider} · ${state.ai.used ?? 0} of ${state.ai.limit || '∞'} requests today` }, state.ai.model),
        h('div', { class: 'spacer' }),
        h('button', { onclick: clearChat, disabled: !!busy || !chat.transcript.length, title: 'Start a new conversation' }, 'Clear'),
        h('button', { class: 'icon-btn', 'aria-label': 'Close chat', onclick: () => setState({ chatOpen: false }) }, '✕'),
      ),
      log,
      h(
        'div',
        {
          class: 'chat-compose',
          ondragover: (e) => e.preventDefault(),
          ondrop: (e) => {
            e.preventDefault();
            attach([...(e.dataTransfer?.files ?? [])]);
          },
        },
        attachments.length
          ? h(
              'div',
              { class: 'chat-thumbs' },
              attachments.map((a, i) =>
                h('span', { class: 'chat-thumb' }, h('img', { src: a.thumb, alt: 'Attachment' }), h('button', { class: 'icon-btn', 'aria-label': 'Remove image', onclick: () => (attachments.splice(i, 1), setState({})) }, '✕')),
              ),
            )
          : null,
        attachError ? h('div', { class: 'error' }, attachError) : null,
        input,
        h(
          'div',
          { class: 'chat-actions' },
          fileInput,
          h('button', { onclick: () => fileInput.click(), disabled: !!busy, title: 'Attach a photo or sketch (or paste / drop one)' }, 'Image'),
          h('div', { class: 'spacer' }),
          busy
            ? h('button', { onclick: () => busy?.controller.abort() }, 'Stop')
            : h('button', { class: 'primary', onclick: send }, 'Send'),
        ),
      ),
    ),
  );
  log.scrollTop = log.scrollHeight;
}
