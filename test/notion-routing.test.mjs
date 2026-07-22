import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NOTION_DATABASE_SCHEMAS } from "../extension/lib/notion.js";

const background=readFileSync(new URL("../extension/background.js",import.meta.url),"utf8");
const options=readFileSync(new URL("../extension/options.html",import.meta.url),"utf8");
const workflow=readFileSync(new URL("../.github/workflows/daily-sync.yml",import.meta.url),"utf8");
const notionClient=readFileSync(new URL("../extension/lib/notion.js",import.meta.url),"utf8");

test("defines four independent Notion database schemas",()=>{
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS),["clip","weread","douban","weibo"]);
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.clip.properties),["标题","类型","原文","作者","摘要","标签","收藏时间","外部 ID"]);
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.weread.properties),["书名","作者","原书链接","划线数量","同步摘要","标签","同步时间","外部 ID"]);
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.douban.properties),["名称","类型","原条目","主创","状态","评分","短评","标签","收藏时间","外部 ID"]);
  assert.deepEqual(Object.keys(NOTION_DATABASE_SCHEMAS.weibo.properties),["博文","用户","原博文","正文摘要","转发数","评论数","点赞数","标签","发布时间","外部 ID"]);
  for(const schema of Object.values(NOTION_DATABASE_SCHEMAS)){
    assert.equal(Object.values(schema.properties).filter(value=>"title" in value).length,1);
    assert.deepEqual(schema.properties["外部 ID"],{rich_text:{}});
  }
});

test("routes every extension source to its own configured database",()=>{
  assert.match(background,/notionDatabaseIds/);
  assert.match(background,/databaseIds\[source\]/);
  for(const source of ["clip","weread","douban","weibo"]){
    assert.match(options,new RegExp(`id="${source}DatabaseId"`));
    assert.match(options,new RegExp(`data-notion-source="${source}"`));
  }
});

test("uses separate WeRead and Douban database secrets in Actions",()=>{
  assert.match(workflow,/NOTION_WEREAD_DATABASE_ID/);
  assert.match(workflow,/NOTION_DOUBAN_DATABASE_ID/);
});

test("uses Notion-supported emoji icons in block payloads",()=>{
  assert.doesNotMatch(notionClient,/emoji:\s*"(?:✦|◌)"/);
  assert.match(notionClient,/emoji:\s*"💡"/);
});
