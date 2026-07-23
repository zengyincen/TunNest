import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NOTION_DATABASE_SCHEMAS, contentFingerprint, syncItems, verifyNotion } from "../extension/lib/notion.js";

const background=readFileSync(new URL("../extension/background.js",import.meta.url),"utf8");
const options=readFileSync(new URL("../extension/options.html",import.meta.url),"utf8");
const workflow=readFileSync(new URL("../.github/workflows/daily-sync.yml",import.meta.url),"utf8");
const notionClient=readFileSync(new URL("../extension/lib/notion.js",import.meta.url),"utf8");
const databaseData=(source,id="a".repeat(32))=>({id,title:[],properties:Object.fromEntries(Object.entries(NOTION_DATABASE_SCHEMAS[source].properties).map(([name,definition])=>[name,{type:Object.keys(definition)[0]}]))});

test("defines independent Notion schemas including four Douban databases",()=>{
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS),["clip","weread","douban","doubanMovieTop250","doubanBookTop250","doubanMusicTop250","weibo"]);
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.clip.properties),["标题","封面","类型","原文","作者","摘要","标签","收藏时间","外部 ID","内容指纹"]);
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.weread.properties),["书名","封面","作者","原书链接","划线数量","同步摘要","标签","同步时间","外部 ID","内容指纹"]);
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.douban.properties),["名称","封面","封面原图","类型","原条目","主创","状态","评分","短评","标签","收藏时间","外部 ID","内容指纹"]);
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.doubanMovieTop250.properties),["名称","封面","封面原图","排名","评分","评价人数","导演","主演","年份","国家/地区","类型","推荐语","原条目","标签","抓取时间","外部 ID","内容指纹"]);
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.doubanBookTop250.properties),["名称","封面","封面原图","排名","评分","评价人数","作者","译者","出版社","出版日期","定价","推荐语","原条目","标签","抓取时间","外部 ID","内容指纹"]);
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.doubanMusicTop250.properties),["名称","封面","封面原图","排名","评分","评价人数","艺术家","发行日期","版本类型","介质","流派","推荐语","原条目","标签","抓取时间","外部 ID","内容指纹"]);
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.weibo.properties),["博文","封面","用户","原博文","正文摘要","转发数","评论数","点赞数","标签","发布时间","外部 ID","内容指纹"]);
  for(const schema of Object.values(NOTION_DATABASE_SCHEMAS)){
    assert.equal(Object.values(schema.properties).filter(value=>"title" in value).length,1);
    assert.deepEqual(schema.properties["外部 ID"],{rich_text:{}});
    assert.deepEqual(schema.properties["内容指纹"],{rich_text:{}});
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

test("routes Douban artwork through the configured Cloudflare image proxy",()=>{
  assert.match(notionClient,/\/v1\/images\/douban\?url=/);
  assert.match(notionClient,/PRODUCT\.licenseApiBase/);
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
    const result=await syncItems("token","d".repeat(32),[{source:"doubanMovieTop250",kind:"movie",externalId:"1292052",title:"肖申克的救赎",url:"https://movie.douban.com/subject/1292052/",coverUrl:"https://img.test/poster.jpg",tags:["豆瓣","电影 Top 250"],capturedAt:"2026-07-23T00:00:00Z",metadata:{rank:1,rating:9.7,ratingCount:3306537,director:"弗兰克·德拉邦特",cast:"蒂姆·罗宾斯",years:"1994",region:"美国",genres:["犯罪","剧情"],quote:"希望让人自由。"}}],"doubanMovieTop250");
    assert.equal(result[0].ok,true);
    const payload=JSON.parse(calls.find(call=>call.url.endsWith("/pages")).init.body);
    assert.equal(payload.children,undefined);
    assert.equal(payload.properties["排名"].number,1);
    assert.equal(payload.properties["评分"].number,9.7);
    assert.equal(payload.properties["评价人数"].number,3306537);
    assert.equal(payload.properties["导演"].rich_text[0].text.content,"弗兰克·德拉邦特");
    assert.equal(payload.properties["主演"].rich_text[0].text.content,"蒂姆·罗宾斯");
    assert.equal(payload.properties["年份"].rich_text[0].text.content,"1994");
    assert.equal(payload.properties["国家/地区"].rich_text[0].text.content,"美国");
    assert.deepEqual(payload.properties["类型"].multi_select,[{name:"犯罪"},{name:"剧情"}]);
    assert.equal(payload.properties["推荐语"].rich_text[0].text.content,"希望让人自由。");
  }finally{globalThis.fetch=previousFetch;}
});

test("uses a cached Cloudflare URL for Douban covers without downloading or uploading",async()=>{
  const previousFetch=globalThis.fetch,calls=[],coverUrl="https://img1.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg";
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    const value=String(url);
    let data={};
    if(value.endsWith("/query"))data={results:[]};
    else if(value.includes("/databases/")&&init.method!=="PATCH")data=databaseData("doubanMovieTop250","e".repeat(32));
    else if(value.endsWith("/pages"))data={id:"douban-page"};
    return{ok:true,status:200,json:async()=>data};
  };
  try{
    const result=await syncItems("token","e".repeat(32),[{kind:"movie",externalId:"1292052",title:"肖申克的救赎",url:"https://movie.douban.com/subject/1292052/",coverUrl,tags:["豆瓣"],capturedAt:"2026-07-23T00:00:00Z",metadata:{rank:1}}],"doubanMovieTop250");
    assert.equal(result[0].ok,true);
    assert.equal(calls.some(call=>call.url===coverUrl),false);
    assert.equal(calls.some(call=>call.url.includes("/file_uploads")),false);
    const create=calls.find(call=>call.url.endsWith("/pages"));
    const payload=JSON.parse(create.init.body);
    const proxyUrl=`https://tnlcs.imnotfound.eu.org/v1/images/douban?url=${encodeURIComponent(coverUrl)}`;
    assert.deepEqual(payload.properties["封面"],{files:[{name:"封面",type:"external",external:{url:proxyUrl}}]});
    assert.deepEqual(payload.properties["封面原图"],{url:coverUrl});
    assert.deepEqual(payload.cover,{type:"external",external:{url:proxyUrl}});
  }finally{globalThis.fetch=previousFetch;}
});

test("does not upload an already Notion-hosted Douban cover again",async()=>{
  const previousFetch=globalThis.fetch,calls=[],coverUrl="https://img2.doubanio.com/view/photo/s_ratio_poster/public/p2913554676.jpg";
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    const value=String(url);
    let data={};
    if(value.endsWith("/query"))data={results:[{id:"existing-douban",properties:{"封面":{files:[{type:"file",file:{url:"https://prod-files-secure.s3.us-west-2.amazonaws.com/cover.jpg"}}]}}}]};
    else if(value.includes("/databases/")&&init.method!=="PATCH")data=databaseData("doubanBookTop250","f".repeat(32));
    return{ok:true,status:200,json:async()=>data};
  };
  try{
    const result=await syncItems("token","f".repeat(32),[{kind:"book",externalId:"book-1",title:"测试书",url:"https://book.douban.com/subject/1/",coverUrl,tags:["豆瓣"],capturedAt:"2026-07-23T00:00:00Z",metadata:{rank:1}}],"doubanBookTop250");
    assert.equal(result[0].ok,true);
    assert.equal(calls.some(call=>call.url===coverUrl),false);
    assert.equal(calls.some(call=>call.url.endsWith("/file_uploads")),false);
    const update=calls.find(call=>call.url.endsWith("/pages/existing-douban"));
    const payload=JSON.parse(update.init.body);
    assert.equal(payload.properties["封面"],undefined);
    assert.equal(payload.cover,undefined);
  }finally{globalThis.fetch=previousFetch;}
});

test("batch-checks existing records and skips unchanged Top 250 writes",async()=>{
  const previousFetch=globalThis.fetch,calls=[],databaseId="7".repeat(32);
  const items=Array.from({length:5},(_,index)=>({
    kind:"music",externalId:`music-${index + 1}`,title:`唱片 ${index + 1}`,
    url:`https://music.douban.com/subject/${index + 1}/`,coverUrl:`https://img1.doubanio.com/view/photo/s_ratio_poster/public/p${index + 1}.jpg`,
    tags:["豆瓣","音乐 Top 250"],capturedAt:"2026-07-23T00:00:00Z",
    metadata:{rank:index + 1,rating:9.1,ratingCount:1000 + index,artist:`歌手 ${index + 1}`,releaseDate:"2026-01-01",releaseType:"专辑",medium:"CD",genres:["流行"],quote:"推荐语"}
  }));
  const pages=await Promise.all(items.map(async(item)=>({id:`page-${item.externalId}`,properties:{
    "名称":{title:[{plain_text:item.title}]},"封面":{files:[{type:"file",file:{url:"https://notion.example/cover.jpg"}}]},"封面原图":{url:item.coverUrl},
    "排名":{number:item.metadata.rank},"评分":{number:item.metadata.rating},"评价人数":{number:item.metadata.ratingCount},
    "艺术家":{rich_text:[{plain_text:item.metadata.artist}]},"发行日期":{rich_text:[{plain_text:item.metadata.releaseDate}]},
    "版本类型":{select:{name:item.metadata.releaseType}},"介质":{select:{name:item.metadata.medium}},"流派":{multi_select:item.metadata.genres.map((name)=>({name}))},
    "推荐语":{rich_text:[{plain_text:item.metadata.quote}]},
    "原条目":{url:item.url},"标签":{multi_select:item.tags.map((name)=>({name}))},"外部 ID":{rich_text:[{plain_text:item.externalId}]},
    "内容指纹":{rich_text:[{plain_text:await contentFingerprint(item,"doubanMusicTop250")}]}
  }})));
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    const value=String(url);
    const data=value.endsWith("/query")?{results:pages,has_more:false}:value.includes("/databases/")&&init.method!=="PATCH"?databaseData("doubanMusicTop250",databaseId):{};
    return{ok:true,status:200,json:async()=>data};
  };
  try{
    const result=await syncItems("token",databaseId,items,"doubanMusicTop250");
    assert.equal(result.every((item)=>item.ok),true);
    const queries=calls.filter((call)=>call.url.endsWith("/query"));
    assert.equal(queries.length,1);
    assert.equal(JSON.parse(queries[0].init.body).filter.or.length,5);
    assert.equal(calls.some((call)=>/\/pages(?:\/|$)/.test(new URL(call.url).pathname)),false);
    assert.equal(calls.some((call)=>call.url.includes("/file_uploads")),false);
  }finally{globalThis.fetch=previousFetch;}
});

test("uses batch duplicate checks for multi-item WeRead synchronization",async()=>{
  const previousFetch=globalThis.fetch,calls=[],databaseId="8".repeat(32);
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    const value=String(url),data=value.endsWith("/query")?{results:[],has_more:false}:value.includes("/databases/")&&init.method!=="PATCH"?databaseData("weread",databaseId):value.endsWith("/pages")?{id:`book-${calls.length}`} : {};
    return{ok:true,status:200,json:async()=>data};
  };
  try{
    const items=Array.from({length:5},(_,index)=>({kind:"book",externalId:`book-${index}`,title:`书籍 ${index}`,url:`https://weread.qq.com/web/bookDetail/${index}`,highlights:[],tags:["微信读书"],capturedAt:"2026-07-23T00:00:00Z"}));
    const result=await syncItems("token",databaseId,items,"weread");
    assert.equal(result.every((item)=>item.ok),true);
    const queries=calls.filter((call)=>call.url.endsWith("/query"));
    assert.equal(queries.length,1);
    assert.equal(JSON.parse(queries[0].init.body).filter.or.length,5);
    assert.equal(calls.filter((call)=>call.url.endsWith("/pages")).length,5);
  }finally{globalThis.fetch=previousFetch;}
});

test("skips an unchanged item by content fingerprint even when the sync timestamp changes",async()=>{
  const previousFetch=globalThis.fetch,calls=[],databaseId="9".repeat(32);
  const original={kind:"book",externalId:"book-stable",title:"稳定内容",author:"作者",url:"https://weread.qq.com/web/bookDetail/stable",excerpt:"摘要",highlights:[{chapter:"一",text:"划线",note:"笔记"}],tags:["微信读书"],capturedAt:"2026-07-22T00:00:00Z"};
  const next={...original,capturedAt:"2026-07-23T00:00:00Z"};
  const fingerprint=await contentFingerprint(original,"weread");
  assert.equal(await contentFingerprint(next,"weread"),fingerprint);
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    const value=String(url),data=value.endsWith("/query")?{results:[{id:"stable-page",properties:{"内容指纹":{rich_text:[{plain_text:fingerprint}]}}}]}:value.includes("/databases/")&&init.method!=="PATCH"?databaseData("weread",databaseId):{};
    return{ok:true,status:200,json:async()=>data};
  };
  try{
    const result=await syncItems("token",databaseId,[next],"weread");
    assert.equal(result[0].ok,true);
    assert.equal(calls.some((call)=>call.url.endsWith("/pages/stable-page")),false);
    assert.equal(calls.some((call)=>call.url.includes("/blocks/stable-page")),false);
  }finally{globalThis.fetch=previousFetch;}
});

test("changes the content fingerprint for notes, images, and interaction data",async()=>{
  const base={kind:"post",externalId:"post-fingerprint",title:"微博",content:"正文",images:["https://wx1.sinaimg.cn/large/a.jpg"],highlights:[],tags:["微博"],metadata:{attitudes:1}};
  const fingerprint=await contentFingerprint(base,"weibo");
  assert.notEqual(await contentFingerprint({...base,content:"更新正文"},"weibo"),fingerprint);
  assert.notEqual(await contentFingerprint({...base,images:["https://wx1.sinaimg.cn/large/b.jpg"]},"weibo"),fingerprint);
  assert.notEqual(await contentFingerprint({...base,metadata:{attitudes:2}},"weibo"),fingerprint);
  const book={kind:"book",externalId:"book-note",title:"书",highlights:[{text:"划线",note:"旧笔记"}]};
  assert.notEqual(await contentFingerprint(book,"weread"),await contentFingerprint({...book,highlights:[{text:"划线",note:"新笔记"}]},"weread"));
});

test("updates properties and managed body when an existing item changes",async()=>{
  const previousFetch=globalThis.fetch,calls=[],databaseId="0".repeat(32);
  const oldItem={kind:"article",externalId:"changed-page",title:"文章",url:"https://example.com/changed",content:"旧正文",tags:[]};
  const newItem={...oldItem,content:"新正文"};
  const oldFingerprint=await contentFingerprint(oldItem,"clip");
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    const value=String(url);let data={};
    if(value.endsWith("/query"))data={results:[{id:"changed-notion-page",properties:{"内容指纹":{rich_text:[{plain_text:oldFingerprint}]}}}]};
    else if(value.includes("/databases/")&&init.method!=="PATCH")data=databaseData("clip",databaseId);
    else if(value.includes("/blocks/changed-notion-page/children")&&init.method!=="PATCH")data={results:[]};
    return{ok:true,status:200,json:async()=>data};
  };
  try{
    const result=await syncItems("token",databaseId,[newItem],"clip");
    assert.equal(result[0].ok,true);
    const pageUpdate=calls.find((call)=>call.url.endsWith("/pages/changed-notion-page")&&call.init.method==="PATCH");
    assert.ok(pageUpdate);
    assert.equal(JSON.parse(pageUpdate.init.body).properties["内容指纹"].rich_text[0].text.content,await contentFingerprint(newItem,"clip"));
    const bodyUpdate=calls.find((call)=>call.url.endsWith("/blocks/changed-notion-page/children")&&call.init.method==="PATCH");
    assert.match(bodyUpdate.init.body,/新正文/);
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
    assert.deepEqual(Object.keys(patches[1]),["封面","作者","原书链接","划线数量","同步摘要","标签","同步时间","外部 ID","内容指纹"]);
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
