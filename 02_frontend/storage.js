// storage.js
// 存储层。这一版用浏览器 localStorage(网页版);
// 套 Tauri 时只换这个文件的实现为真正写进 ~/.starnet/personal/,
// 界面(app.js)和格式(starnet-format.js)零改动 —— 这是"先网页后桌面不返工"的关键。
//
// 对外接口(Tauri 版也必须实现这同一套,签名不变):
//   Storage.list()            -> [{ id, type, title, ...record, body }]   全部偏好
//   Storage.save(record, body)-> void                                     新建或覆盖
//   Storage.remove(id)        -> void                                     删除(走 trash)
//   Storage.get(id)           -> { record, body } | null
//
// 数据在 localStorage 里按 "starnet:item:<id>" 存整段 markdown 文本,
// 和真实文件系统的"一条一个 .md"一一对应,换 Tauri 时语义不变。

const ITEM_PREFIX = 'starnet:item:';
const TRASH_PREFIX = 'starnet:trash:';

const Storage = {
  // 列出全部:解析每段 markdown,返回 record + body 合并的对象
  list() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(ITEM_PREFIX)) continue;
      const text = localStorage.getItem(key);
      try {
        const { record, body } = window.StarnetFormat.parseMarkdown(text);
        out.push({ ...record, body });
      } catch (e) {
        // 宪法第十一节:解析失败提示而不是崩 —— 这里跳过坏数据,不让整个列表挂掉
        console.warn('跳过解析失败的条目', key, e.message);
      }
    }
    // 按 updated 倒序,最近改的在上面
    out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    return out;
  },

  // 取单条
  get(id) {
    const text = localStorage.getItem(ITEM_PREFIX + id);
    if (!text) return null;
    return window.StarnetFormat.parseMarkdown(text);
  },

  // 新建或覆盖:record + body -> markdown 文本 -> localStorage
  save(record, body) {
    const md = window.StarnetFormat.buildMarkdown(record, body);
    localStorage.setItem(ITEM_PREFIX + record.id, md);
  },

  // 删除走 trash(宪法第十一节:不直接删)
  remove(id) {
    const text = localStorage.getItem(ITEM_PREFIX + id);
    if (text == null) return;
    localStorage.setItem(TRASH_PREFIX + id, text);
    localStorage.removeItem(ITEM_PREFIX + id);
  },
};

if (typeof window !== 'undefined') window.Storage = Storage;
