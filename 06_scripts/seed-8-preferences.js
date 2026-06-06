// seed-8-preferences.js
// 一次性导入:把创始人 A 档 8 条偏好(来自实时进度文档「导入地图」)写进
//   ~/.starnet/personal/preferences/
// 用途:点亮节点图(批次 2-① 折入),让"第一次看见自己的大脑"有内容。
// 复用 02_frontend/starnet-format.js 生成,保证 id/字段顺序合数据格式宪法。
//
// 幂等:按 title 的 slug 判重,已存在(slug 相同)就跳过,不重复写、不覆盖用户已改的内容。
// 跑法:node 06_scripts/seed-8-preferences.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const F = require('../02_frontend/starnet-format.js');

const DIR = path.join(os.homedir(), '.starnet', 'personal', 'preferences');

// 来源:实时进度文档「导入地图(A档8条)」。内容用大白话,贴合创始人偏好。
const SEEDS = [
  {
    title: '用大白话,直接给判断',
    priority: 'high',
    tags: ['沟通', '风格'],
    body: '跟我说话用大白话,别绕弯子。该下判断就直接下,不要只罗列一堆选项让我自己挑。',
  },
  {
    title: '技术任务主动扛,只抛关键决策',
    priority: 'high',
    tags: ['协作', '风格'],
    body: '技术活你主动扛下来往前推,别每一步都来问我。只在真正需要我拍板的关键决策上停下来抛给我。',
  },
  {
    title: '可以直接指出我的错,但要客观',
    priority: 'high',
    tags: ['沟通', '风格'],
    body: '我错了就直接说,别顺着我。但判断要基于事实和逻辑——不要无依据的悲观唱衰,也不要为了讨好我而献媚。',
  },
  {
    title: '用创业者视角,不是评估师视角',
    priority: 'medium',
    tags: ['协作', '视角'],
    body: '站在和我一起把产品做成的创业者视角想问题,不要站在旁观评估师的位置上挑毛病、唱衰。',
  },
  {
    title: '别纠正错别字,术语可中英混用',
    priority: 'low',
    tags: ['沟通', '风格'],
    body: '我打字的错别字不用纠正,看懂就行。技术术语我会中英文混着用,你照常理解,不用提醒。',
  },
  {
    title: '我的环境:Win11 双盘,PowerShell + Bash',
    priority: 'medium',
    tags: ['环境', '系统'],
    body: '我用 Windows 11,双硬盘。命令行 PowerShell 和 Bash 都能用,给命令时按这个环境来。',
  },
  {
    title: '用客观痛点和能力指标判断,不靠讨好用户',
    priority: 'high',
    tags: ['产品', '决策'],
    body: '判断一个东西做得够不够,看它有没有硬解决客观存在的痛点,门槛用能力指标。不要用"用户喜不喜欢/有多少人用"来要饭式讨好。',
  },
  {
    title: '偏好要让任何 AI 都自动加载',
    priority: 'high',
    tags: ['星网', '核心'],
    body: '我登记的偏好,目标是让任何 AI agent 都能在开口前自动加载、无感注入,而不是每次还要手动去查。',
  },
];

function existingSlugs() {
  if (!fs.existsSync(DIR)) return new Set();
  const slugs = new Set();
  for (const name of fs.readdirSync(DIR)) {
    if (!name.endsWith('.md')) continue;
    // 文件名形如 pref-<slug>-<uuid>.md,去掉前缀 pref- 和末尾 -<uuid>.md
    const m = name.match(/^pref-(.+)-[a-z0-9]{4}\.md$/);
    if (m) slugs.add(m[1]);
  }
  return slugs;
}

function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const have = existingSlugs();
  let written = 0;
  let skipped = 0;

  for (const seed of SEEDS) {
    const slug = F.slugify(seed.title);
    if (have.has(slug)) {
      console.log(`跳过(已存在): ${seed.title}`);
      skipped++;
      continue;
    }
    const { record, body, filename } = F.createRecord({
      type: 'preference',
      title: seed.title,
      body: seed.body,
      priority: seed.priority,
      tags: seed.tags,
      appliesTo: [], // 空 = 所有 AI 都适用
    });
    const md = F.buildMarkdown(record, body);
    fs.writeFileSync(path.join(DIR, filename), md, 'utf8');
    console.log(`写入: ${filename}`);
    written++;
  }

  console.log(`\n完成:新写入 ${written} 条,跳过 ${skipped} 条。目录:${DIR}`);
}

main();
