export const topics = ['Money','Business','Politics','Sports','Games','Style & Culture','Technology','Coffee','General'];

export const publications = [
  {name:'GQ',url:'https://www.gq.com/',note:'Style and culture'},
  {name:'China Today',url:'https://www.chinatoday.com.cn/ctenglish/',note:'Read on publisher site'},
  {name:'Capital Ethiopia',url:'https://capitalethiopia.com/',note:'Ethiopian business'},
  {name:'Financial Times',url:'https://www.ft.com/',note:'Money and business'},
  {name:'The Wall Street Journal',url:'https://www.wsj.com/',note:'Business and world affairs'},
  {name:'The New York Times',url:'https://www.nytimes.com/',note:'World news'},
  {name:'Bloomberg Businessweek',url:'https://www.bloomberg.com/businessweek',note:'Business and markets'},
  {name:'Tadias Magazine',url:'https://www.tadias.com/',note:'Ethiopian culture'},
  {name:'Ethiopian Business Review',url:'https://ethiopianbusinessreview.net/',note:'Ethiopian business'},
  {name:'አዲስ ማለዳ',url:'https://addismaleda.com/',note:'አማርኛ',lang:'am'}
];

const rules = [
  ['Money',/\b(financ\w*|bank\w*|inflation|invest\w*|stock\w*|currency|currencies|forex|tax\w*|interest rates?|bonds?|budget\w*|debt|pension\w*|savings|crypto\w*|capital markets?)\b|ባንክ|ገንዘብ|ግብር|ኢንቨስት/i],
  ['Business',/\b(business|econom\w*|compan\w*|corporat\w*|trade|industr\w*|export\w*|import\w*|startup\w*|start-up\w*|entrepreneur\w*|retail\w*|revenue|supply chain|ceo|merger\w*|acquisition\w*)\b|ንግድ|ኢኮኖሚ|ኩባንያ/i],
  ['Politics',/\b(politic\w*|elect\w*|parliament\w*|president\w*|prime minister|government\w*|legislat\w*|diploma\w*|senat\w*|congress\w*|minister\w*|democra\w*|republican\w*|war|military|ceasefire|sanctions?)\b|ፖለቲካ|ምርጫ|መንግሥት|መንግስት|ፓርላማ/i],
  ['Sports',/\b(sports?|football|soccer|basketball|tennis|athlet\w*|olympic\w*|premier league|champions league|world cup|marathon|cricket|rugby|formula (?:1|one)|nba|nfl)\b|ስፖርት|እግር ኳስ|አትሌት/i],
  ['Games',/\b(gaming|video games?|videogames?|playstation|xbox|nintendo|esports?|steam deck|board games?|puzzles?|crosswords?|wordle)\b|ጨዋታ/i],
  ['Style & Culture',/\b(fashion|style|culture|art|arts|music|film\w*|movie\w*|literature|books?|novel\w*|design\w*|sneakers?|menswear|watches|exhibition\w*)\b|ባህል|ሙዚቃ|ሥነ ጥበብ|ስነ ጥበብ|መጽሐፍ/i],
  ['Technology',/\b(tech\w*|artificial intelligence|ai|software|cyber\w*|digital|robot\w*|semiconductor\w*|smartphone\w*|internet|comput\w*)\b|ቴክኖሎጂ|ዲጂታል/i],
  ['Coffee',/\b(coffee|espresso|barista\w*|cafe|café|roast\w*|caffeine)\b|ቡና/i]
];

// Use feed tags, headline and URL; never infer a topic solely from a publication's name.
// Older saved/offline editions are classified with the same rules when rendered.
export function classifyStory(story) {
  const text = [story.title,story.url,...(Array.isArray(story.tags)?story.tags:[])].join(' ');
  const found = rules.filter(([,pattern])=>pattern.test(text)).map(([topic])=>topic);
  if(topics.includes(story.feedTopic)&&!found.includes(story.feedTopic))found.push(story.feedTopic);
  if(story.region==='Coffee'&&!found.includes('Coffee'))found.push('Coffee');
  if(!found.length){
    if(story.source==='GQ')found.push('Style & Culture');
    else if(['Capital Ethiopia','Financial Times','The Wall Street Journal','Bloomberg Businessweek','Ethiopian Business Review'].includes(story.source))found.push('Business');
  }
  return found.length?found:['General'];
}
