import { syncItems } from "./lib/notion.mjs";
import { getWereadItems } from "./sources/weread.mjs";
import { getDoubanItems } from "./sources/douban.mjs";

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
  const items=await getDoubanItems({userId:required("DOUBAN_USER_ID"),apiKey:required("DOUBAN_API_KEY"),authToken:process.env.DOUBAN_AUTH_TOKEN,apiHost:process.env.DOUBAN_API_HOST});
  failedCount+=await syncSource("douban",databaseId("DOUBAN"),items);
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
function databaseId(target){return process.env[`NOTION_${target}_DATABASE_ID`]?.trim()||process.env.NOTION_DATABASE_ID?.trim()||required(`NOTION_${target}_DATABASE_ID`);}
function required(name){const value=process.env[name]?.trim();if(!value)throw new Error(`缺少环境变量 ${name}`);return value;}
