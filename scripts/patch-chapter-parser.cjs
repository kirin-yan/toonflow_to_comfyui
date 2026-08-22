const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const webFile = path.resolve(__dirname, "../data/web/index.html");

const parserReplacement = String.raw`Boe=/^[\t ]*第\s*([0-9０-９零〇一二三四五六七八九十百千万亿两兩]+)\s*卷(?:[\t ]*[:：、.\-—]?[\t ]*([^\n\r]*))?[\t ]*$/gm,UPo=/^[\t ]*第\s*([0-9０-９零〇一二三四五六七八九十百千万亿两兩]+)\s*[章回节](?:[\t ]*[:：、.\-—]?[\t ]*([^\n\r]*))?[\t ]*$/gm;
function Oxe(e){const t=String(e??"").trim().replace(/[０-９]/g,n=>String(n.charCodeAt(0)-65296)).replace(/[〇]/g,"零").replace(/[两兩]/g,"二");if(/^\d+$/.test(t))return Number.parseInt(t,10);const n={零:0,一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};if(!/[十百千万亿]/.test(t)){const r=[...t].map(o=>n[o]);return r.every(o=>o!==void 0)?Number(r.join("")):Number.NaN}const r={十:10,百:100,千:1e3,万:1e4,亿:1e8};let o=0,s=0,a=0;for(const l of t)if(n[l]!==void 0)a=n[l];else{const d=r[l];if(!d)return Number.NaN;if(d>=1e4)s+=a,s===0&&(s=1),o+=s*d,s=0;else a===0&&(a=1),s+=a*d;a=0}return o+s+a}
function tfChapterRegex(){const e=ha().otherSetting.chapterReg,t="/第\\s*([0-9０-９零一二三四五六七八九十百千万]+)\\s*[章回节]\\s*([^\\n\\r]*)/g";if(!e||String(e)===t)return new RegExp(UPo.source,UPo.flags);try{const n=String(e).match(/^\/([\s\S]*)\/([a-z]*)$/i),r=n?n[1]:String(e);let o=n?n[2]:"";o.includes("g")||(o+="g"),o=[...new Set(o)].join("");return new RegExp(r,o)}catch(n){return console.warn("章节拆分正则无效，已回退默认规则:",n),new RegExp(UPo.source,UPo.flags)}}
function tfMatches(e,t){return t.lastIndex=0,Array.from(e.matchAll(t))}
function tfChapters(e,t,n){const r=tfMatches(e,t),o=r.filter(h=>h[1]!=null);if(r.length&&o.length===0&&t.source!==UPo.source)return console.warn("自定义章节正则缺少章节编号捕获组，已回退默认规则"),tfChapters(e,new RegExp(UPo.source,UPo.flags),n);if(!o.length)return e.trim()?[{index:1,chapter:"",text:e.trim()}]:[];const s=[],a=e.slice(0,o[0].index).trim();a&&s.push({index:0,chapter:n,text:a});for(let h=0;h<o.length;h++){const f=o[h],g=f.index+f[0].length,k=h+1<o.length?o[h+1].index:e.length,A=e.slice(g,k).replace(/^[\r\n]+/,"").trim(),m=Oxe(f[1]);s.push({index:Number.isFinite(m)?m:h+1,chapter:String(f[2]??"").trim(),text:A})}return s}
function jPo(e){const t=String(e??"").replace(/\r\n?/g,"\n"),n=tfMatches(t,new RegExp(Boe.source,Boe.flags)),r=tfChapterRegex();if(!n.length)return[{index:1,reel:"正文卷",chapters:tfChapters(t,r,"前言")}];const o=[],s=t.slice(0,n[0].index).trim();s&&o.push({index:0,reel:"前言",chapters:[{index:0,chapter:"前言",text:s}]});for(let a=0;a<n.length;a++){const l=n[a],d=l.index+l[0].length,u=a+1<n.length?n[a+1].index:t.length,h=t.slice(d,u),f=Oxe(l[1]),g=String(l[2]??"").trim();o.push({index:Number.isFinite(f)?f:a+1,reel:g||"第"+l[1]+"卷",chapters:tfChapters(h,new RegExp(r.source,r.flags),"卷首")})}return o}`;

const textDecoderReplacement = String.raw`function tfDecodeNovelText(C){const x=new Uint8Array(C);if(x.length>=2&&x[0]===255&&x[1]===254)return new TextDecoder("utf-16le").decode(x);if(x.length>=2&&x[0]===254&&x[1]===255)return new TextDecoder("utf-16be").decode(x);try{return new TextDecoder("utf-8",{fatal:!0}).decode(x)}catch{try{return new TextDecoder("gb18030",{fatal:!0}).decode(x)}catch{return new TextDecoder().decode(x)}}}async function v(C){const x=await C.arrayBuffer(),L=String(C.name??"").toLowerCase();return C.type==="text/plain"||L.endsWith(".txt")?tfDecodeNovelText(x):(await iv.extractRawText({arrayBuffer:x})).value}`;

function testParser() {
  const settings = { chapterReg: "" };
  const context = { console, ha: () => ({ otherSetting: settings }) };
  vm.runInNewContext(`${parserReplacement};globalThis.__chapterTest={jPo,Oxe}`, context);
  const { jPo, Oxe } = context.__chapterTest;

  assert.equal(Oxe("１２"), 12);
  assert.equal(Oxe("两百零三"), 203);
  assert.equal(Oxe("一万零二"), 10002);

  const inline = jPo("他说请参见第三章内容，然后继续。");
  assert.equal(inline[0].chapters.length, 1);
  assert.match(inline[0].chapters[0].text, /第三章/);

  const withPreface = jPo("作品简介\n第１２章 开始\n正文\n第两百零三章 结束\n尾声");
  assert.deepEqual(
    Array.from(withPreface[0].chapters, (item) => [item.index, item.chapter]),
    [[0, "前言"], [12, "开始"], [203, "结束"]],
  );

  const reels = jPo("第1卷\n第1章 A\na\n第2卷\n第1章 B\nb");
  assert.equal(reels.length, 2);
  assert.deepEqual(Array.from(reels, (item) => item.reel), ["第1卷", "第2卷"]);

  settings.chapterReg = String.raw`第\s*(\d+)\s*章\s*([^\n\r]*)`;
  assert.equal(jPo("第1章 A\na\n第2章 B\nb")[0].chapters.length, 2);

  settings.chapterReg = String.raw`/第\s*([0-9０-９零一二三四五六七八九十百千万]+)\s*[章回节]\s*([^\n\r]*)/g`;
  assert.equal(jPo("他说请参见第三章内容，然后继续。")[0].chapters.length, 1);

  const decoderContext = { TextDecoder };
  vm.runInNewContext(`${textDecoderReplacement};globalThis.__decode=tfDecodeNovelText`, decoderContext);
  assert.equal(decoderContext.__decode(Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]).buffer), "中文");
}

function patchWebBuild() {
  let html = fs.readFileSync(webFile, "utf8");
  let parserStart = html.indexOf("Boe=/^(\u7b2c");
  if (parserStart < 0) parserStart = html.indexOf("Boe=/^[\\t ]*第");
  const parserEnd = html.indexOf("var iv={}", parserStart);
  if (parserStart < 0 || parserEnd < 0) throw new Error("未找到章节解析器构建产物");
  html = html.slice(0, parserStart) + parserReplacement + html.slice(parserEnd);

  const oldDecoder = 'async function v(C){const x=await C.arrayBuffer();return C.type==="text/plain"?new TextDecoder().decode(x):(await iv.extractRawText({arrayBuffer:x})).value}';
  if (!html.includes(oldDecoder) && !html.includes("function tfDecodeNovelText(C)")) throw new Error("未找到 TXT 解码函数");
  html = html.replace(oldDecoder, textDecoderReplacement);

  const oldFileTypes = 'const L=["text/plain","application/vnd.openxmlformats-officedocument.wordprocessingml.document"];if(x.type==="application/msword")';
  const newFileTypes = 'const L=["text/plain","application/vnd.openxmlformats-officedocument.wordprocessingml.document"],tfName=String(x.name??"").toLowerCase();if(x.type==="application/msword")';
  if (html.includes(oldFileTypes)) html = html.replace(oldFileTypes, newFileTypes);
  const oldTypeCheck = 'if(!L.includes(x.type))return window.$message.error($t("workbench.novel.import.msg.unsupportedType")),!1;';
  const newTypeCheck = 'if(!L.includes(x.type)&&!tfName.endsWith(".txt")&&!tfName.endsWith(".docx"))return window.$message.error($t("workbench.novel.import.msg.unsupportedType")),!1;';
  if (html.includes(oldTypeCheck)) html = html.replace(oldTypeCheck, newTypeCheck);

  fs.writeFileSync(webFile, html);
}

testParser();
patchWebBuild();
console.log("章节拆分逻辑补丁已应用，回归测试通过。");
