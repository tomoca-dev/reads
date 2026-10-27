'use client';
import {useEffect,useRef,useState} from 'react';
import {classifyStory} from '../lib/topics.mjs';
import {ArrowUpRight,ChevronLeft,ChevronRight,X} from 'lucide-react';
type Story={title:string;summary:string;url:string;image?:string;source:string;region:string;published:string;language?:string};
export default function MagazineReader({story,stories,onSelect,onClose}:{story:Story;stories:Story[];onSelect:(s:Story)=>void;onClose:()=>void}){
  const dialog=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null),touch=useRef<{x:number;y:number}|null>(null);
  const [textSize,setTextSize]=useState(22);
  const excerptWords=story.summary?.trim().split(/\s+/).filter(Boolean).length||0;
  const index=stories.findIndex(s=>s.url===story.url);
  const previous=index>0?stories[index-1]:null,next=index>=0?stories[index+1]:null;
  useEffect(()=>{const before=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';close.current?.focus();return()=>{document.body.style.overflow=overflow;before?.focus();};},[]);
  useEffect(()=>{dialog.current?.scrollTo({top:0});},[story.url]);
  function keyDown(e:React.KeyboardEvent){
    if(e.key==='Escape'){e.preventDefault();onClose();}
    if(e.key==='ArrowRight'&&next){e.preventDefault();onSelect(next);}
    if(e.key==='ArrowLeft'&&previous){e.preventDefault();onSelect(previous);}
    if(e.key==='Tab'){
      const elements=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]');
      if(!elements?.length)return;const first=elements[0],last=elements[elements.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  }
  return <div className="magazine-backdrop" onClick={onClose}><section ref={dialog} className="magazine-reader" role="dialog" aria-modal="true" aria-labelledby="reader-title" onClick={e=>e.stopPropagation()} onKeyDown={keyDown} onTouchStart={e=>{const t=e.touches[0];touch.current={x:t.clientX,y:t.clientY};}} onTouchEnd={e=>{const t=e.changedTouches[0],start=touch.current;touch.current=null;if(!start||Math.abs(t.clientY-start.y)>50)return;const dx=t.clientX-start.x;if(dx< -85&&next)onSelect(next);else if(dx>85&&previous)onSelect(previous);}}>
    <div className="reader-toolbar"><span>TOMOCA <i>reads.</i></span><span>{index>=0?`${index+1} / ${stories.length}`:'Reading preview'}</span><button ref={close} onClick={onClose} aria-label="Close reading preview"><X size={22}/></button></div>
    <div className={'reader-cover'+(!story.image?' reader-cover-type':'')} key={story.url}>{story.image&&<img src={story.image} alt="" onError={e=>{e.currentTarget.style.display='none'}}/>}<div className="reader-cover-copy"><span className="eyebrow">{story.region} / {story.source}</span><h2 id="reader-title" lang={story.language||'en'}>{story.title}</h2></div></div>
    <div className="reader-body"><div className="article-byline"><span>{story.source}</span><span>Publisher excerpt{excerptWords>0?` · ${excerptWords} words`:''}</span></div><div style={{display:'flex',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:12,marginTop:20}}><span className="small">{classifyStory(story).join(' · ')}</span><div role="group" aria-label="Reading text size" style={{display:'flex',alignItems:'center',gap:8}}><span className="small">Text size</span>{[{size:18,label:'Small'},{size:22,label:'Medium'},{size:26,label:'Large'}].map(option=><button key={option.size} aria-label={option.label+' reading text'} aria-pressed={textSize===option.size} onClick={()=>setTextSize(option.size)} style={{minWidth:44,minHeight:44,padding:8,border:'1px solid var(--line)',background:textSize===option.size?'var(--ink)':'transparent',color:textSize===option.size?'var(--paper)':'inherit',borderRadius:4}}>{option.label==='Small'?'A':option.label==='Medium'?'A+':'A++'}</button>)}</div></div><p className="reader-excerpt" lang={story.language||'en'} style={{fontSize:textSize,lineHeight:1.9,maxWidth:'65ch',overflowWrap:'anywhere'}}>{story.summary||'This publisher has not supplied a reading excerpt for this story. Open the original below to continue.'}</p><a className="reader-original" href={story.url} target="_blank" rel="noopener noreferrer">Read the full story at {story.source}<ArrowUpRight size={17}/></a><p className="small">You are reading a publisher excerpt. The full article opens on the publisher’s website and may require their subscription.</p></div>
    <nav className="reader-pagination" aria-label="Browse reading previews"><button disabled={!previous} onClick={()=>previous&&onSelect(previous)}><ChevronLeft size={20}/><span>Previous story</span></button><span>Keep discovering</span><button disabled={!next} onClick={()=>next&&onSelect(next)}><span>Next story</span><ChevronRight size={20}/></button></nav>
  </section></div>;
}
