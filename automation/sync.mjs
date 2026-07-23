import { syncItems } from "./lib/notion.mjs";
import { getWereadItems } from "./sources/weread.mjs";
import { getDoubanItems } from "./sources/douban.mjs";
import { DOUBAN_TOP250_TARGETS, fetchAllDoubanTop250 } from "../extension/lib/douban-top250.js";
import { enrichMovieCovers } from "../extension/lib/cover-providers.js";

const source=(process.env.SOURCE||"all").toLowerCase();
if(!["all","weread","douban"].includes(source))throw new Error("SOURCE 仅支持 all、weread 或 douban");
await verifyLicense();
const notionToken=required("NOTION_TOKEN");
let failedCount=0;

if(source==="all"||source==="weread"){
  const items=await getWereadItems(required("WEREAD_API_KEY"));
  failedCount+=await syncSource("weread",databaseId("WEREAD"),items);
}
if(source==="all"||source==="douban"){
  const provider=process.env.MOVIE_COVER_PROVIDER||"douban",tmdbAccessToken=process.env.TMDB_ACCESS_TOKEN;
  const userResult=await enrichMovieCovers(await getDoubanItems({userId:required("DOUBAN_USER_ID"),authToken:process.env.DOUBAN_AUTH_TOKEN,apiHost:process.env.DOUBAN_API_HOST}),{provider,tmdbAccessToken,onProgress:tmdbProgress});
  const items=userResult.items;
  failedCount+=await syncSource("douban",databaseId("DOUBAN"),items);
  const top250=await fetchAllDoubanTop250({headers:{"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0 Safari/537.36"}});
  const movieResult=await enrichMovieCovers(top250.doubanMovieTop250,{provider,tmdbAccessToken,onProgress:tmdbProgress});
  top250.doubanMovieTop250=movieResult.items;
  for(const target of DOUBAN_TOP250_TARGETS){
    const envTarget=target.source.replace(/^douban/,"").replace(/Top250$/,"_TOP250").replace(/([a-z])([A-Z])/g,"$1_$2").toUpperCase();
    failedCount+=await syncSource(target.source,databaseId(`DOUBAN_${envTarget}`),top250[target.source]);
  }
}
if(failedCount)process.exitCode=1;

async function syncSource(target,databaseIdValue,items){
  console.log(`准备同步 ${items.length} 条 ${target} 内容`);
  const results=await syncItems(notionToken,databaseIdValue,items,target),failed=results.filter(item=>!item.ok);
  console.log(`${target} 同步完成：成功 ${results.length-failed.length}，失败 ${failed.length}`);
  for(const item of failed)console.error(`- ${item.title}: ${item.error}`);
  return failed.length;
}
async function verifyLicense(){const base=required("LICENSE_API_BASE"),licenseKey=required("TUNNEST_LICENSE_KEY"),repository=process.env.GITHUB_REPOSITORY||"local",deviceId=process.env.LICENSE_DEVICE_ID||`${repository}:actions`;const response=await fetch(`${base.replace(/\/$/,"")}/v1/licenses/verify`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({licenseKey,deviceId,clientType:"github-actions",deviceLabel:repository,extensionVersion:"github-actions"})});const data=await response.json().catch(()=>({}));if(!response.ok||!data.valid)throw new Error(data.error||"需要有效付费许可证，GitHub Actions 不提供试用同步");console.log(`付费许可证有效：${data.license.plan}${data.license.expiresAt?`，到期 ${data.license.expiresAt}`:"，永久"}`)}
function databaseId(target){const name=`NOTION_${target}_DATABASE_ID`,specific=process.env[name]?.trim();if(specific)return specific;if(["WEREAD","DOUBAN"].includes(target)&&process.env.NOTION_DATABASE_ID?.trim())return process.env.NOTION_DATABASE_ID.trim();return required(name);}
function required(name){const value=process.env[name]?.trim();if(!value)throw new Error(`缺少环境变量 ${name}`);return value;}
function tmdbProgress({completed,total,matched}){if(completed===total||completed%25===0)console.log(`TMDB 海报匹配 ${completed}/${total}，已匹配 ${matched}`);}
