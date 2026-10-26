import {XMLParser} from 'fast-xml-parser';

export const sources = [
  {name:'Daily Coffee News',region:'Coffee',url:'https://dailycoffeenews.com/feed/',host:'dailycoffeenews.com'},
  {name:'Coffee Intelligence',region:'Coffee',url:'https://intelligence.coffee/feed/',host:'intelligence.coffee'},
  {name:'Capital Ethiopia',region:'Ethiopia',url:'https://capitalethiopia.com/feed/',host:'capitalethiopia.com'},
  {name:'The Reporter',region:'Ethiopia',url:'https://www.thereporterethiopia.com/feed/',host:'thereporterethiopia.com'},
  {name:'Fana Media',region:'Ethiopia',url:'https://www.fanamc.com/english/feed/',host:'fanamc.com'},
  {name:'አዲስ አድማስ',region:'Amharic',language:'am',url:'https://www.addisadmassnews.com/index.php?Itemid=180&id=1&layout=category&option=com_k2&task=category&view=itemlist&format=feed&type=rss',host:'addisadmassnews.com'},
  {name:'ፋና አማርኛ',region:'Amharic',language:'am',url:'https://www.fanamc.com/feed/',host:'fanamc.com'},
  {name:'Africanews',region:'Africa',url:'https://www.africanews.com/feed/rss',host:'africanews.com'},
  {name:'Daily Maverick',region:'Africa',url:'https://www.dailymaverick.co.za/dmrss/',host:'dailymaverick.co.za'},
  {name:'BBC World',region:'Global',url:'https://feeds.bbci.co.uk/news/world/rss.xml',host:'bbc.com',feedHosts:['feeds.bbci.co.uk','bbci.co.uk','bbc.co.uk','bbc.com']},
  {name:'The Guardian',region:'Global',url:'https://www.theguardian.com/world/rss',host:'theguardian.com'},
  {name:'Al Jazeera',region:'Global',url:'https://www.aljazeera.com/xml/rss/all.xml',host:'aljazeera.com'}
];

const parser = new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',processEntities:false});
const decodeEntities = value => String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(entity,key)=>{if(key[0]!=='#')return ({amp:'&',lt:'<',gt:'>',quot:'\"',apos:"'"})[key.toLowerCase()]||entity;const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):entity;});
const clean = value => decodeEntities(typeof value === 'object' ? (value?.['#text'] || '') : value || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const arr = value => Array.isArray(value) ? value : value ? [value] : [];
const MAX_FEED_BYTES = Number((typeof process !== 'undefined' && process.env?.RSS_MAX_BYTES) || 2 * 1024 * 1024);
const MAX_REDIRECTS = 3;

function hostAllowed(hostname, allowed) {
  const host = hostname.toLowerCase();
  return allowed.some(base => host === base || host.endsWith('.' + base));
}

function feedHosts(source) {
  return source.feedHosts || [new URL(source.url).hostname,source.host];
}

async function readTextLimited(response, maxBytes = MAX_FEED_BYTES) {
  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > maxBytes) throw new Error(`Feed response exceeds ${maxBytes} bytes`);
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch {}
      throw new Error(`Feed response exceeds ${maxBytes} bytes`);
    }
    text += decoder.decode(value,{stream:true});
  }
  return text + decoder.decode();
}

async function fetchFeed(source) {
  const allowed = feedHosts(source);
  let current = new URL(source.url);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    if (current.protocol !== 'https:' || !hostAllowed(current.hostname,allowed)) throw new Error('Blocked RSS destination');
    const response = await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'User-Agent':'TOMOCAReads/1.1 (RSS reader)'}});
    if ([301,302,303,307,308].includes(response.status)) {
      if (redirectCount === MAX_REDIRECTS) throw new Error('Too many RSS redirects');
      const location = response.headers.get('location');
      if (!location) throw new Error('RSS redirect is missing Location');
      const next = new URL(location,current);
      if (next.protocol !== 'https:' || !hostAllowed(next.hostname,allowed)) throw new Error('Blocked RSS redirect destination');
      current = next;
      continue;
    }
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return readTextLimited(response);
  }
  throw new Error('Unable to fetch RSS feed');
}

export function parseFeed(xml,source) {
  const tree = parser.parse(xml);
  return arr(tree.rss?.channel?.item || tree.feed?.entry).map(item => {
    const url = typeof item.link === 'string' ? item.link : arr(item.link).find(link => !link['@_rel'] || link['@_rel'] === 'alternate')?.['@_href'];
    const media = arr(item['media:content']).find(entry => entry['@_url']) || arr(item['media:thumbnail'])[0];
    const html = String(item['content:encoded'] || item.description || '');
    let image = media?.['@_url'] || item.enclosure?.['@_url'] || html.match(/<img[^>]+src=["']([^"']+)/i)?.[1] || null;
    try { if (image && new URL(image).protocol !== 'https:') image = null; } catch { image = null; }
    return {
      title:clean(item.title),
      url:decodeEntities(url || ''),
      summary:clean(item.description || item.summary).replace(/\s+The post[\s\S]*?appeared first on[\s\S]*$/i,'').slice(0,1100),
      published:clean(item.pubDate || item.published || item.updated),
      image,
      source:source.name,
      region:source.region,
      language:source.language || 'en'
    };
  }).filter(item => {
    try {
      const url = new URL(item.url);
      return url.protocol === 'https:' &&
        (url.hostname === source.host || url.hostname.endsWith('.' + source.host) || (source.name === 'BBC World' && url.hostname === 'www.bbc.co.uk')) &&
        item.title.length > 12 &&
        !/casino|gambling|stake bonus|rolletto|betting promo/i.test(item.title + ' ' + item.url);
    } catch {
      return false;
    }
  }).slice(0,9);
}

const coffeeSnapshot = [
  {title:'University of Hawaii to Lead New Federal Coffee and Cacao Research Lab',url:'https://dailycoffeenews.com/2026/10/16/university-of-hawaii-to-lead-new-federal-coffee-and-cacao-research-lab/',summary:'A new research programme focuses on coffee and cacao resilience, varieties and farm practices.',published:'2026-10-16',source:'Daily Coffee News',region:'Coffee',image:null,cached:true},
  {title:'EUDR Compliance Gaps Persist for Smallholders, New Report Finds',url:'https://dailycoffeenews.com/2026/10/07/eudr-compliance-gaps-persist-for-smallholders-new-report-finds/',summary:'A report examines the obstacles smallholder farmers face in meeting deforestation rules.',published:'2026-10-07',source:'Daily Coffee News',region:'Coffee',image:null,cached:true}
];

export function withCoffeeFallback(edition) {
  return edition.stories.some(story => story.region === 'Coffee') ? edition : {...edition,stories:[...edition.stories,...coffeeSnapshot]};
}

export function uniqueStories(stories) {
  const seen = new Set();
  return stories.filter(item => {
    const key = item.title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'') || item.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function collect() {
  const results = await Promise.all(sources.map(async source => {
    const started = Date.now();
    try {
      const xml = await fetchFeed(source);
      const stories = parseFeed(xml,source);
      return {name:source.name,ok:stories.length > 0,count:stories.length,latencyMs:Date.now()-started,error:null,stories};
    } catch (error) {
      return {name:source.name,ok:false,count:0,latencyMs:Date.now()-started,error:String(error?.message || 'Feed unavailable').slice(0,160),stories:[]};
    }
  }));

  const stories = uniqueStories(results.flatMap(result => result.stories));
  stories.sort((a,b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  return withCoffeeFallback({updated:Date.now(),stories,health:results.map(({stories,...result}) => result)});
}
