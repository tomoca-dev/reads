'use client';
import {useEffect,useRef} from 'react';
import {ArrowUpRight,ChevronLeft,ChevronRight,X} from 'lucide-react';
type Story={title:string;summary:string;url:string;image?:string;source:string;region:string;published:string;language?:string};
export default function MagazineReader({story,stories,onSelect,onClose}:{story:Story;stories:Story[];onSelect:(s:Story)=>void;onClose:()=>void}){
  const dialog=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null),touch=useRef<{x:number;y:number}|null>(null);
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
    <div className="reader-body"><div className="article-byline"><span>{story.source}</span><span>Publisher excerpt</span></div><p className="reader-excerpt" lang={story.language||'en'}>{story.summary||'Explore the complete reporting at the original publisher.'}</p><a className="reader-original" href={story.url} target="_blank" rel="noopener noreferrer">Continue at {story.source}<ArrowUpRight size={17}/></a><p className="small">Full reporting belongs to its publisher.</p></div>
    <nav className="reader-pagination" aria-label="Browse reading previews"><button disabled={!previous} onClick={()=>previous&&onSelect(previous)}><ChevronLeft size={20}/><span>Previous story</span></button><span>Keep discovering</span><button disabled={!next} onClick={()=>next&&onSelect(next)}><span>Next story</span><ChevronRight size={20}/></button></nav>
  </section></div>;
}
