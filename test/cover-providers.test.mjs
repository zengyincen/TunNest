import assert from "node:assert/strict";
import test from "node:test";
import { enrichMovieCovers } from "../extension/lib/cover-providers.js";

const movie={kind:"movie",externalId:"1292052",title:"肖申克的救赎",coverUrl:"https://img1.doubanio.com/poster.jpg",metadata:{years:"1994"}};

test("uses an exact TMDB title and year match as the preferred movie poster",async()=>{
  const previousFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    return{ok:true,status:200,headers:new Headers(),json:async()=>({results:[
      {id:1,title:"肖申克的救赎",original_title:"The Shawshank Redemption",release_date:"1994-09-23",poster_path:"/poster.jpg",popularity:100},
      {id:2,title:"不相关电影",release_date:"1994-01-01",poster_path:"/wrong.jpg",popularity:999}
    ]})};
  };
  try{
    const result=await enrichMovieCovers([movie],{provider:"tmdb-first",tmdbAccessToken:"token"});
    assert.equal(result.items[0].coverUrl,"https://image.tmdb.org/t/p/w500/poster.jpg");
    assert.equal(result.items[0].metadata.coverSource,"TMDB");
    assert.equal(result.items[0].metadata.originalCoverUrl,movie.coverUrl);
    assert.equal(result.items[0].metadata.tmdbId,1);
    assert.equal(calls.length,1);
    assert.equal(calls[0].init.headers.Authorization,"Bearer token");
    assert.equal(new URL(calls[0].url).searchParams.get("year"),"1994");
  }finally{globalThis.fetch=previousFetch;}
});

test("keeps the Douban image when fallback mode already has a cover",async()=>{
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error("TMDB should not be called");};
  try{
    const result=await enrichMovieCovers([movie],{provider:"tmdb-fallback",tmdbAccessToken:"token"});
    assert.equal(result.items[0],movie);
    assert.equal(result.searched,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("reuses a fresh local TMDB match cache",async()=>{
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error("TMDB should not be called");};
  try{
    const cache={"1292052:1994":{url:"https://image.tmdb.org/t/p/w500/cached.jpg",tmdbId:99,fetchedAt:new Date().toISOString()}};
    const result=await enrichMovieCovers([movie],{provider:"tmdb-first",tmdbAccessToken:"token",cache});
    assert.equal(result.items[0].coverUrl,"https://image.tmdb.org/t/p/w500/cached.jpg");
    assert.equal(result.searched,0);
  }finally{globalThis.fetch=previousFetch;}
});
