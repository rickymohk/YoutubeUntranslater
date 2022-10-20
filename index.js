// ==UserScript==
// @name         Youtube Untranslater
// @namespace    https://github.com/rickymohk/YoutubeUntranslater/
// @version      0.1
// @description  Remove auto-translated youtube titles. Inspired by pcouy/YoutubeAutotranslateCanceler, rewritten in mordern way.
// @author       Ricky Mo
// @match        https://www.youtube.com/
// @match        https://youtube.com/
// @match        https://www.youtube.com/watch*
// @match        https://youtube.com/watch*
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.deleteValue
// ==/UserScript==

const TAG = "YoutubeUntranslater"
const log = {
    error(...data){
        console.error(TAG,...data);
    },
    info(...data){
        console.info(TAG,...data);
    }
}
const API_KEY = "api_key";

async function getApiKey()
{
    let apiKey = await GM.getValue(API_KEY);
    if(!apiKey)
    {
        apiKey = prompt("Enter your API key. Go to https://developers.google.com/youtube/v3/getting-started to know how to obtain an API key, then go to https://console.developers.google.com/apis/api/youtube.googleapis.com/ in order to enable Youtube Data API for your key.");
        await GM.setValue(API_KEY,apiKey);
    }
    return apiKey;
}

function getVideoId(node)
{
    // log.info("anchorToVideoId a.href",a.href);
    let a = node;
    while(a.tagName != "A"){
        a = a.parentNode;
    }
    try {
        const url = new URL(a.href);
        if(url.pathname == "/watch")
        {
            return new URLSearchParams(url.search).get("v");
        }
        else if(url.pathname.includes("/shorts/"))
        {
            return url.pathname.split("/")[2];
        }
    } catch (err) {
        log.error(err);
        log.info("Error anchor",a);
    }
    return undefined;
}

let currentLocation;

let isMainChanged = false;
let isPreviewChanged = false;
let cachedTitles = {};
let revertedAnchors = new Set();
let isApiKeyValid = false;
let noApiKey = true;

function reset()
{
    log.info("Page change detected. reset");
    currentLocation = document.title;
    isMainChanged = false;
    isPreviewChanged = false;
    revertedAnchors.clear();
}

function linkify(inputText) {
    var replacedText, replacePattern1, replacePattern2, replacePattern3;

    //URLs starting with http://, https://, or ftp://
    replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
    replacedText = inputText.replace(replacePattern1, '<a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="$1">$1</a>');


    //URLs starting with "www." (without // before it, or it'd re-link the ones done above).
    replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
    replacedText = replacedText.replace(replacePattern2, '<a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="http://$1">$1</a>');

    //Change email addresses to mailto:: links.
    replacePattern3 = /(([a-zA-Z0-9\-\_\.])+@[a-zA-Z\_]+?(\.[a-zA-Z]{2,6})+)/gim;
    replacedText = replacedText.replace(replacePattern3, '<a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="mailto:$1">$1</a>');

    return replacedText;
}

async function untranslate(apiKey)
{
    if(currentLocation != document.title)
    {
        reset();
    }
    if(noApiKey){
        log.error("No API key");
        return;
    }
    const isLive = document.querySelector(".ytp-live") != null;
    let mainVidId;
    // log.info("isMainChanged",isMainChanged);
    if(!isMainChanged && !isLive)
    {
        mainVidId = window.location.pathname == "/watch" && new URLSearchParams(location.search).get("v");
    }
    // mainVidId = undefined;
    const spans = [...document.querySelectorAll("span#video-title")].filter(a => !revertedAnchors.has(a));
    const ytFormattedStrings = [...document.querySelectorAll("yt-formatted-string#video-title:not(.ytd-video-preview)")].filter(a => !revertedAnchors.has(a));
    let preview = document.querySelector("#preview #details:not([hidden]) yt-formatted-string.ytd-video-preview");
    if(!preview)
    {
        isPreviewChanged = false;
    }
    else if(isPreviewChanged)
    {
        preview = undefined;
    }
    let nodes = [...spans,...ytFormattedStrings,preview].filter(it => it);
    // log.info("mainVidId",mainVidId);
    // log.info("preview",preview);
    // log.info("Anchors found",anchors);

    if(!(mainVidId || nodes.length > 0 || preview)) return;
    
    const ids = [mainVidId,...nodes.map(getVideoId).filter(id => id && !cachedTitles[id])];
    // log.info("ids",ids);
    if(ids.length <= 0) return;
    const reqUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.join(",")}&key=${apiKey}`;
    try {
        const res = await fetch(reqUrl);
        const json = await res.json();
        if(json.kind == "youtube#videoListResponse")
        {
            const {items} = json;

            if(mainVidId)
            {
                const item = items.find(it => it.id == mainVidId);
                console.log("main item",item);
                if(item)
                {
                    const {snippet} = item;
                    const title = snippet.title?.trim();
                    //Revert main title
                    const mainTitleNode = document.querySelector("ytd-watch-flexy:not([hidden]) #container > h1 > yt-formatted-string");
                    console.log("mainTitleNode",mainTitleNode);
                    if(mainTitleNode && title)
                    {
                        log.info(`Reverting main video title from ${mainTitleNode.innerHTML} to ${title}`);
                        mainTitleNode.innerHTML = title;
                        mainTitleNode.removeAttribute("is-empty");
                        //Revert description
                        const descriptionNode = document.querySelector("yt-formatted-string.content.style-scope.ytd-video-secondary-info-renderer");
                        if(descriptionNode && snippet.description)
                        {
                            descriptionNode.innerHTML = linkify(snippet.description);
                        }
                        isMainChanged = true;
                    }
                }
            }
            for(let item of items)
            {
                cachedTitles[item.id] = item?.snippet?.title;
            }
            for(let node of nodes)
            {
                const cachedTitle = cachedTitles[getVideoId(node)];
                if(cachedTitle)
                {
                    const translatedTitle = node.innerHTML.trim();
                    if(translatedTitle != cachedTitle.replace(/\s{2,}/g, " "))
                    {
                        log.info(`Reverting ${translatedTitle} to ${cachedTitle}`);
                        node.innerHTML = cachedTitle;
                    }
                    if(!revertedAnchors.has(node))
                    {
                        revertedAnchors.add(node);
                    }
                }
            }
            if(preview)
            {
                const id = getVideoId(preview);
                const cachedTitle = cachedTitles[id];
                if(cachedTitle)
                {
                    const translatedTitle = preview.innerHTML.trim();
                    if(translatedTitle != cachedTitle.replace(/\s{2,}/g," "))
                    {
                        log.info(`Reverting preview ${translatedTitle} to ${cachedTitle}`);
                        preview.innerHTML = cachedTitle;
                        isPreviewChanged = true;
                    }
                }
            }
        }
        else
        {
            log.error("API request failed");
            noApiKey = !isApiKeyValid;
            if(noApiKey)
            {
                // GM.deleteValue(API_KEY);
                log.error("API key fail. Please Reload");
            }
        }
    } catch (err) {
        log.error(err);
    }
}

(async ()=>{
    'use strict';
    const apiKey = await getApiKey();
    noApiKey = !apiKey;
    if(noApiKey)
    {
        log.error("No API key");
        return;
    }
    // log.info("API key:",apiKey);
    setInterval(() => {
        untranslate(apiKey).catch(err => log.error(err));
    }, 1000);

})();