// storage.js
// 存储层(双模式)。
//   · 在 Tauri 桌面壳里  -> 调 Rust 命令,真正读写 ~/.starnet/personal/*.md
//   · 在普通浏览器里     -> 退回 localStorage(网页版照样能跑、能验证逻辑)
//
// 关键设计:接口签名对 app.js 保持不变,但全部返回 Promise(因为 Tauri 命令是异步的)。
// app.js 里调用处统一用 await。格式解析仍全交给 starnet-format.js,这层只搬运整段 markdown 文本。
//
// 对外接口:
//   Storage.list()             -> Promise<[{ id, type, title, ...record, body }]>
//   Storage.get(id)            -> Promise<{ record, body } | null>
//   Storage.save(record, body) -> Promise<void>
//   Storage.remove(id)         -> Promise<void>
//   Storage.dataDir()          -> Promise<string|null>  (Tauri 下返回数据目录,网页版返回 null)

const ITEM_PREFIX = 'starnet:item:';
const TRASH_PREFIX = 'starnet:trash:';

// 是否跑在 Tauri 里(withGlobalTauri 注入了 window.__TAURI__)
const IN_TAURI = typeof window !== 'undefined' && !!window.__TAURI__;
const invoke = IN_TAURI ? window.__TAURI__.core.invoke : null;

// ---------- Tauri 真实文件实现 ----------
const TauriStorage = {
  async list() {
    const items = await invoke('list_items'); // [{ id, text }]
    const out = [];
    for (const it of items) {
      try {
        const { record, body } = window.StarnetFormat.parseMarkdown(it.text);
        out.push({ ...record, body });
      } catch (e) {
        console.warn('跳过解析失败的条目', it.id, e.message);
      }
    }
    out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    return out;
  },
  async get(id) {
    const text = await invoke('get_item', { id });
    if (text == null) return null;
    return window.StarnetFormat.parseMarkdown(text);
  },
  async save(record, body) {
    const md = window.StarnetFormat.buildMarkdown(record, body);
    await invoke('save_item', { id: record.id, text: md });
  },
  async remove(id) {
    await invoke('remove_item', { id });
  },
  async dataDir() {
    return invoke('data_dir');
  },
};

// ---------- localStorage 实现(网页版回退)----------
const WebStorage = {
  async list() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(ITEM_PREFIX)) continue;
      const text = localStorage.getItem(key);
      try {
        const { record, body } = window.StarnetFormat.parseMarkdown(text);
        out.push({ ...record, body });
      } catch (e) {
        console.warn('跳过解析失败的条目', key, e.message);
      }
    }
    out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    return out;
  },
  async get(id) {
    const text = localStorage.getItem(ITEM_PREFIX + id);
    if (!text) return null;
    return window.StarnetFormat.parseMarkdown(text);
  },
  async save(record, body) {
    const md = window.StarnetFormat.buildMarkdown(record, body);
    localStorage.setItem(ITEM_PREFIX + record.id, md);
  },
  async remove(id) {
    const text = localStorage.getItem(ITEM_PREFIX + id);
    if (text == null) return;
    localStorage.setItem(TRASH_PREFIX + id, text);
    localStorage.removeItem(ITEM_PREFIX + id);
  },
  async dataDir() {
    return null;
  },
};

const Storage = IN_TAURI ? TauriStorage : WebStorage;

if (typeof window !== 'undefined') {
  window.Storage = Storage;
  window.STARNET_IN_TAURI = IN_TAURI;
}
