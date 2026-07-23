import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NOTION_DATABASE_SCHEMAS, syncItems, verifyNotion } from "../extension/lib/notion.js";

const background=readFileSync(new URL("../extension/background.js",import.meta.url),"utf8");
const options=readFileSync(new URL("../extension/options.html",import.meta.url),"utf8");
const workflow=readFileSync(new URL("../.github/workflows/daily-sync.yml",import.meta.url),"utf8");
const notionClient=readFileSync(new URL("../extension/lib/notion.js",import.meta.url),"utf8");
const databaseData=(source,id="a".repeat(32))=>({id,title:[],properties:Object.fromEntries(Object.entries(NOTION_DATABASE_SCHEMAS[source].properties).map(([name,definition])=>[name,{type:Object.keys(definition)[0]}]))});

test("defines independent Notion schemas including four Douban databases",()=>{
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS),["clip","weread","douban","doubanMovieTop250","doubanBookTop250","doubanMusicTop250","weibo"]);
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.clip.properties),["标题","封面","类型","原文","作者","摘要","标签","收藏时间","外部 ID"]);
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.weread.properties),["书名","封面","作者","原书链接","划线数量","同步摘要","标签","同步时间","外部 ID"]);
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.douban.properties),["名称","封面","类型","原条目","主创","状态","评分","短评","标签","收藏时间","外部 ID"]);
  for(const source of ["doubanMovieTop250","doubanBookTop250","doubanMusicTop250"]){
    assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS[source].properties),["名称","封面","排名","评分","评价人数","信息","推荐语","原条目","标签","抓取时间","外部 ID"]);
  }
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.weibo.properties),["博文","封面","用户","原博文","正文摘要","转发数","评论数","点赞数","标签","发布时间","外部 ID"]);
  for(const schema of Object.values(NOTION_DATABASE_SCHEMAS)){
    assert.equal(Object.values(schema.properties).filter(value=>"title" in value).length,1);
    assert.deepEqual(schema.properties["外部 ID"],{rich_text:{}});
    assert.deepEqual(schema.properties["封面"],{files:{}});
  }
});

test("routes every extension source to its own configured database",()=>{
  assert.match(background,/notionDatabaseIds/);
  assert.match(background,/databaseIds\[source\]/);
  for(const source of ["clip","weread","douban","weibo"]){
    assert.match(options,new RegExp(`id="${source}DatabaseId"`));
    assert.match(options,new RegExp(`data-notion-source="${source}"`));
  }
  for(const source of ["doubanMovieTop250","doubanBookTop250","doubanMusicTop250"]){
    assert.match(options,new RegExp(`id="${source}DatabaseId"`));
    assert.match(options,new RegExp(`data-notion-source="${source}"`));
  }
});

test("uses separate WeRead and Douban database secrets in Actions",()=>{
  assert.match(workflow,/NOTION_WEREAD_DATABASE_ID/);
  assert.match(workflow,/NOTION_DOUBAN_DATABASE_ID/);
  assert.match(workflow,/NOTION_DOUBAN_MOVIE_TOP250_DATABASE_ID/);
  assert.match(workflow,/NOTION_DOUBAN_BOOK_TOP250_DATABASE_ID/);
  assert.match(workflow,/NOTION_DOUBAN_MUSIC_TOP250_DATABASE_ID/);
});

test("uses Notion-supported emoji icons in block payloads",()=>{
  assert.doesNotMatch(notionClient,/emoji:\s*"(?:✦|◌)"/);
  assert.match(notionClient,/emoji:\s*"💡"/);
});

test("writes book artwork to the page cover and Files property",async()=>{
  const previousFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    const value=String(url),data=value.endsWith("/query")?{results:[]}:value.includes("/databases/")&&init.method!=="PATCH"?databaseData("weread"):value.endsWith("/pages")?{id:"book-page"}:{};
    return{ok:true,status:200,json:async()=>data};
  };
  try{
    const result=await syncItems("token","a".repeat(32),[{
      source:"weread",kind:"book",externalId:"book-1",title:"测试书",author:"作者",
      url:"https://weread.qq.com/web/bookDetail/book-1",coverUrl:"http://cdn.weread.qq.com/cover/book-1.jpg",
      highlights:[],tags:["微信读书"],capturedAt:"2026-07-22T10:00:00Z"
    }],"weread");
    assert.equal(result[0].ok,true);
    const create=calls.find(call=>call.url.endsWith("/pages"));
    const payload=JSON.parse(create.init.body);
    assert.deepEqual(payload.cover,{type:"external",external:{url:"https://cdn.weread.qq.com/cover/book-1.jpg"}});
    assert.deepEqual(payload.properties["封面"],{files:[{name:"封面",type:"external",external:{url:"https://cdn.weread.qq.com/cover/book-1.jpg"}}]});
  }finally{globalThis.fetch=previousFetch;}
});

test("writes a Top 250 entry as property-only structured data",async()=>{
  const previousFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init={})=>{calls.push({url:String(url),init});const value=String(url),data=value.endsWith("/query")?{results:[]}:value.includes("/databases/")&&init.method!=="PATCH"?databaseData("doubanMovieTop250"):value.endsWith("/pages")?{id:"top-page"}:{};return{ok:true,status:200,json:async()=>data};};
  try{
    const result=await syncItems("token","d".repeat(32),[{source:"doubanMovieTop250",kind:"movie",externalId:"1292052",title:"肖申克的救赎",url:"https://movie.douban.com/subject/1292052/",coverUrl:"https://img.test/poster.jpg",tags:["豆瓣","电影 Top 250"],capturedAt:"2026-07-23T00:00:00Z",metadata:{rank:1,rating:9.7,ratingCount:3306537,info:"1994 / 美国",quote:"希望让人自由。"}}],"doubanMovieTop250");
    assert.equal(result[0].ok,true);
    const payload=JSON.parse(calls.find(call=>call.url.endsWith("/pages")).init.body);
    assert.equal(payload.children,undefined);
    assert.equal(payload.properties["排名"].number,1);
    assert.equal(payload.properties["评分"].number,9.7);
    assert.equal(payload.properties["评价人数"].number,3306537);
    assert.equal(payload.properties["推荐语"].rich_text[0].text.content,"希望让人自由。");
  }finally{globalThis.fetch=previousFetch;}
});

test("adds the shared image property to an existing database",async()=>{
  const previousFetch=globalThis.fetch,calls=[];
  const properties=Object.fromEntries(Object.entries(NOTION_DATABASE_SCHEMAS.weread.properties).filter(([name])=>name!=="封面").map(([name,definition])=>[name,{type:Object.keys(definition)[0]}]));
  globalThis.fetch=async(url,init={})=>{calls.push({url:String(url),init});return{ok:true,status:200,json:async()=>({id:"b".repeat(32),title:[],properties})};};
  try{
    const result=await verifyNotion("token","b".repeat(32),"weread");
    assert.equal(result.id,"b".repeat(32));
    const migration=calls.find(call=>call.init.method==="PATCH");
    assert.deepEqual(JSON.parse(migration.init.body),{properties:{"封面":{files:{}}}});
  }finally{globalThis.fetch=previousFetch;}
});

test("renames the title and creates every missing property automatically",async()=>{
  const previousFetch=globalThis.fetch,calls=[],databaseId="c".repeat(32);
  globalThis.fetch=async(url,init={})=>{calls.push({url:String(url),init});return{ok:true,status:200,json:async()=>({id:databaseId,title:[],properties:{Name:{id:"title",type:"title",name:"Name"}}})};};
  try{
    const result=await verifyNotion("token",databaseId,"weread");
    assert.equal(result.id,databaseId);
    const patches=calls.filter(call=>call.init.method==="PATCH").map(call=>JSON.parse(call.init.body).properties);
    assert.deepEqual(patches[0],{Name:{name:"书名"}});
    assert.deepEqual(Object.keys(patches[1]),["封面","作者","原书链接","划线数量","同步摘要","标签","同步时间","外部 ID"]);
    assert.deepEqual(patches[1]["封面"],{files:{}});
    assert.deepEqual(patches[1]["外部 ID"],{rich_text:{}});
  }finally{globalThis.fetch=previousFetch;}
});

test("writes Weibo images and full text into the managed Notion area",async()=>{
  const previousFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    const value=String(url);
    if(value.startsWith("https://wx1.sinaimg.cn/"))return{ok:true,status:200,blob:async()=>new Blob(["image-bytes"],{type:"image/jpeg"})};
    let data={};
    if(value.endsWith("/query"))data={results:[]};
    else if(value.includes("/databases/")&&init.method!=="PATCH")data=databaseData("weibo");
    else if(value.endsWith("/pages"))data={id:"created-page"};
    else if(value.includes("/blocks/created-page/children")&&init.method!=="PATCH")data={results:[]};
    else if(value.endsWith("/file_uploads"))data={id:"upload-id",status:"pending"};
    else if(value.endsWith("/file_uploads/upload-id/send"))data={id:"upload-id",status:"uploaded"};
    else if(value.includes("/blocks/created-page/children"))data={results:[]};
    return{ok:true,status:200,json:async()=>data};
  };
  try{
    const result=await syncItems("token","a".repeat(32),[{
      source:"weibo",kind:"post",externalId:"post-1",title:"完整微博",author:"作者",
      url:"https://weibo.com/1/A",excerpt:"摘要",content:"完整长微博正文",
      images:[{url:"https://wx1.sinaimg.cn/large/a.jpg",caption:"微博配图 1"}],
      tags:["微博"],capturedAt:"2026-07-22T10:00:00Z",metadata:{}
    }],"weibo");
    assert.equal(result[0].ok,true);
    const create=calls.find(call=>call.url.endsWith("/pages"));
    const managed=JSON.parse(create.init.body).children[0];
    assert.equal(managed.type,"synced_block");
    assert.doesNotMatch(JSON.stringify(managed),/TunNest 自动同步区域/);
    const children=managed.synced_block.children;
    assert.ok(children.some(block=>block.type==="paragraph"&&block.paragraph.rich_text[0].text.content==="完整长微博正文"));
    const send=calls.find(call=>call.url.endsWith("/file_uploads/upload-id/send"));
    assert.ok(send.init.body instanceof FormData);
    assert.equal(send.init.headers["Content-Type"],undefined);
    const append=calls.find(call=>call.url.includes("/blocks/created-page/children")&&call.init.method==="PATCH");
    const image=JSON.parse(append.init.body).children[0];
    assert.equal(image.image.type,"file_upload");
    assert.equal(image.image.file_upload.id,"upload-id");
    assert.equal(append.init.headers["Notion-Version"],"2026-03-11");
    const coverUpdate=calls.find(call=>call.url.endsWith("/pages/created-page")&&call.init.method==="PATCH");
    assert.deepEqual(JSON.parse(coverUpdate.init.body).properties["封面"].files[0],{name:"微博配图 1",type:"file_upload",file_upload:{id:"upload-id"}});
  }finally{globalThis.fetch=previousFetch;}
});

test("migrates the legacy toggle to an always-expanded managed block",async()=>{
  const previousFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    const value=String(url);let data={};
    if(value.endsWith("/query"))data={results:[{id:"existing-clip"}]};
    else if(value.includes("/databases/")&&init.method!=="PATCH")data=databaseData("clip");
    else if(value.includes("/blocks/existing-clip/children")&&init.method!=="PATCH")data={results:[{id:"legacy-toggle",type:"toggle",toggle:{rich_text:[{plain_text:"TunNest 自动同步区域"}]}}]};
    return{ok:true,status:200,json:async()=>data};
  };
  try{
    const result=await syncItems("token","a".repeat(32),[{
      source:"clip",kind:"article",externalId:"clip-1",title:"展开的正文",author:"作者",
      url:"https://example.com/article",content:"正文内容",tags:[],capturedAt:"2026-07-22T10:00:00Z"
    }],"clip");
    assert.equal(result[0].ok,true);
    assert.ok(calls.some(call=>call.url.endsWith("/blocks/legacy-toggle")&&call.init.method==="DELETE"));
    const append=calls.find(call=>call.url.includes("/blocks/existing-clip/children")&&call.init.method==="PATCH");
    const managed=JSON.parse(append.init.body).children[0];
    assert.equal(managed.type,"synced_block");
    assert.equal(managed.synced_block.synced_from,null);
    assert.doesNotMatch(JSON.stringify(managed),/TunNest 自动同步区域/);
  }finally{globalThis.fetch=previousFetch;}
});

test("keeps the old content and a source link when image upload fails",async()=>{
  const previousFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    const value=String(url);
    if(value.startsWith("https://wx1.sinaimg.cn/"))return{ok:false,status:403,blob:async()=>new Blob([])};
    let data={};
    if(value.endsWith("/query"))data={results:[{id:"existing-page"}]};
    else if(value.includes("/databases/")&&init.method!=="PATCH")data=databaseData("weibo");
    else if(value.includes("/blocks/existing-page/children")&&init.method!=="PATCH")data={results:[{id:"old-toggle",type:"toggle",toggle:{rich_text:[{plain_text:"TunNest 自动同步区域"}]}}]};
    else if(value.endsWith("/file_uploads"))data={id:"failed-import",status:"failed",file_import_result:"download_failed"};
    else if(value.includes("/blocks/existing-page/children"))data={results:[]};
    return{ok:true,status:200,json:async()=>data};
  };
  try{
    const result=await syncItems("token","a".repeat(32),[{
      source:"weibo",kind:"post",externalId:"post-2",title:"微博",author:"作者",
      url:"https://weibo.com/1/B",content:"正文",images:[{url:"https://wx1.sinaimg.cn/large/b.jpg",caption:"微博配图 1"}],
      tags:["微博"],capturedAt:"2026-07-22T10:00:00Z",metadata:{}
    }],"weibo");
    assert.equal(result[0].ok,false);
    assert.match(result[0].error,/已保留原图链接/);
    const append=calls.find(call=>call.url.includes("/blocks/existing-page/children")&&call.init.method==="PATCH");
    const fallback=JSON.parse(append.init.body).children[0];
    assert.equal(fallback.type,"paragraph");
    assert.equal(fallback.paragraph.rich_text[0].text.link.url,"https://wx1.sinaimg.cn/large/b.jpg");
    assert.equal(calls.some(call=>call.url.endsWith("/blocks/old-toggle")&&call.init.method==="DELETE"),false);
  }finally{globalThis.fetch=previousFetch;}
});
