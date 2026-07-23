import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDouban, normalizeDoubanUserId, signedDoubanUrl } from "../automation/sources/douban.mjs";
import { parseDoubanTop250 } from "../extension/lib/douban-top250.js";

test("normalizes a Douban book interest", () => {
  const item = normalizeDouban({ status: "done", create_time: "2026-07-01T12:00:00+08:00", comment: "值得重读", rating: { value: 5 }, tags: [{ name: "社会学" }], subject: { id: "42", title: "测试书", url: "https://book.douban.com/subject/42/", author: ["某作者"], intro: "简介", genres: ["非虚构"] } }, "book");
  assert.equal(item.externalId, "42");
  assert.equal(item.kind, "book");
  assert.equal(item.highlights[0].text, "值得重读");
  assert.deepEqual(item.tags, ["豆瓣", "社会学", "非虚构"]);
});

test("signs current Frodo requests", () => {
  const url = signedDoubanUrl("frodo.douban.com", "/api/v2/user/ahbei/interests", { type: "book", status: "done", start: "0", count: "1" }, "1784779200");
  assert.equal(url.searchParams.get("_ts"), "1784779200");
  assert.equal(url.searchParams.get("os_rom"), "android");
  assert.equal(url.searchParams.get("_sig"), "BswcjvWC1otpKDkc58TEed+WcvU=");
});

test("accepts a full Douban profile URL", () => {
  assert.equal(normalizeDoubanUserId("https://www.douban.com/people/example.name/"), "example.name");
});

test("parses movie, book and music Top 250 entries", () => {
  const movie=parseDoubanTop250(`<ol class="grid_view"><li><div class="pic"><em>1</em><a href="https://movie.douban.com/subject/1292052/"><img alt="肖申克的救赎" src="https://img.test/movie.jpg"></a></div><div class="bd"><p>导演: 弗兰克·德拉邦特&nbsp;&nbsp;主演: 蒂姆·罗宾斯 / 摩根·弗里曼 /...<br>1994 / 美国 / 犯罪 剧情</p><div><span class="rating_num">9.7</span><span>3306537人评价</span></div><p class="quote"><span>希望让人自由。</span></p></div></li></ol>`,"movie")[0];
  const book=parseDoubanTop250(`<table><tr class="item"><td><a href="https://book.douban.com/subject/1007305/"><img src="https://img.test/s/public/book.jpg"></a></td><td><div class="pl2"><a href="https://book.douban.com/subject/1007305/" title="红楼梦">红楼梦</a></div><p class="pl">[清] 曹雪芹 著 / 某译者 / 人民文学出版社 / 1996-12 / 59.70元</p><span class="rating_nums">9.7</span><span>466268人评价</span><p class="quote"><span class="inq">都云作者痴</span></p></td></tr></table>`,"book")[0];
  const music=parseDoubanTop250(`<table><tr class="item"><td><a href="https://music.douban.com/subject/2995812/"><img src="https://img.test/s/public/music.jpg"></a></td><td><div class="pl2"><a href="https://music.douban.com/subject/2995812/">We Sing</a><p class="pl">Jason Mraz / 2008-05-13 / Import / Audio CD / 民谣/流行</p><div class="star"><span class="rating_nums">9.1</span><span>117051人评价</span></div></div></td></tr></table>`,"music")[0];
  assert.deepEqual([movie.title,movie.metadata.rank,movie.metadata.rating,movie.metadata.ratingCount],["肖申克的救赎",1,9.7,3306537]);
  assert.deepEqual(movie.metadata,{rank:1,rating:9.7,ratingCount:3306537,info:"导演: 弗兰克·德拉邦特 主演: 蒂姆·罗宾斯 / 摩根·弗里曼 /... / 1994 / 美国 / 犯罪 剧情",quote:"希望让人自由。",director:"弗兰克·德拉邦特",cast:"蒂姆·罗宾斯 / 摩根·弗里曼",years:"1994",region:"美国",genres:["犯罪","剧情"]});
  assert.deepEqual([book.title,book.author,book.metadata.translators,book.metadata.publisher,book.metadata.publicationDate,book.metadata.price,book.metadata.quote],["红楼梦","[清] 曹雪芹 著","某译者","人民文学出版社","1996-12","59.70元","都云作者痴"]);
  assert.deepEqual([music.metadata.artist,music.metadata.releaseDate,music.metadata.releaseType,music.metadata.medium,music.metadata.genres],["Jason Mraz","2008-05-13","Import","Audio CD",["民谣","流行"]]);
  assert.deepEqual([music.title,music.author,music.source],["We Sing","Jason Mraz","doubanMusicTop250"]);
  assert.match(book.coverUrl,/\/l\/public\//);
});
