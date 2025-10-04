// Lightweight vanilla Animated Reply utility (no framework)
// Usage:
//   const anim = AnimatedReply.mount(targetElement, {
//       text: 'Xin chào, mình là JAREMIS...','mode':'word', wordDelay:45,
//       startDelay:120,onComplete:()=>{}
//   });
//   // To finish instantly: anim.finish();
//   // To replace with final HTML (e.g. KaTeX-rendered): anim.replace(finalHtml);
//   // To destroy: anim.destroy();
(function(global){
  const MODES = ['char','word','line'];
  function splitSegments(text, mode){
    if(!text) return [];
    if(mode==='char') return Array.from(text);
    if(mode==='word') return text.split(/(\s+)/).filter(Boolean);
    return String(text).split(/\r?\n/); // line
  }
  function AnimatedInstance(el, opts){
    this.el = el;
    this.opts = Object.assign({
      text:'',
      mode:'word',
      charDelay:18,
      wordDelay:50,
      lineDelay:220,
      startDelay:0,
      className:'ai-reply'
    }, opts||{});
    if(!MODES.includes(this.opts.mode)) this.opts.mode='word';
    this._segments = splitSegments(this.opts.text, this.opts.mode);
    this._count = 0;
    this._timer = null;
    this._started = false;
    this._done = false;
    this._host = document.createElement('div');
    this._host.className = this.opts.className;
    this.el.innerHTML='';
    this.el.appendChild(this._host);
    this._start();
  }
  AnimatedInstance.prototype._nextDelay = function(){
    return this.opts.mode==='char'?this.opts.charDelay:(this.opts.mode==='word'?this.opts.wordDelay:this.opts.lineDelay);
  };
  AnimatedInstance.prototype._render = function(){
    const visible = this._segments.slice(0, this._count);
    if(this.opts.mode==='line'){
      this._host.innerHTML = visible.map((l,i)=>`<div class="seg seg-line" style="animation-delay:${Math.min(i*0.03,0.6)}s">${escapeHtml(l)}</div>`).join('');
    } else {
      this._host.innerHTML = '<span class="inline">' + visible.map((t,i)=>`<span class="seg seg-inline" style="animation-delay:${Math.min(i*0.015,0.5)}s">${escapeHtml(t)}</span>`).join('') + '</span>';
    }
  };
  function escapeHtml(s){
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  AnimatedInstance.prototype._tick = function(){
    if(this._done) return;
    this._count++;
    this._render();
    if(this._count >= this._segments.length){
      this._done = true;
      if(typeof this.opts.onComplete==='function') try{ this.opts.onComplete(); }catch(e){}
      return;
    }
    this._timer = setTimeout(this._tick.bind(this), this._nextDelay());
  };
  AnimatedInstance.prototype._start = function(){
    if(this._started) return; this._started = true;
    const applyBaseStyles = ()=>{
      if(!document.getElementById('animated-reply-base-css')){
        const style = document.createElement('style');
        style.id='animated-reply-base-css';
        style.textContent=`.ai-reply{white-space:pre-wrap;line-height:1.6}.ai-reply .seg{opacity:0;animation:aiFade .18s ease-out forwards;will-change:opacity,transform}.ai-reply .seg-inline{display:inline;transform:translateY(2px)}.ai-reply .seg-line{display:block;transform:translateY(4px);margin-bottom:2px}@keyframes aiFade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`;
        document.head.appendChild(style);
      }
    };
    applyBaseStyles();
    this._render();
    this._timer = setTimeout(()=>this._tick(), Math.max(0,this.opts.startDelay));
  };
  AnimatedInstance.prototype.finish = function(){
    if(this._done) return; clearTimeout(this._timer); this._count = this._segments.length; this._done=true; this._render(); };
  AnimatedInstance.prototype.replace = function(html){ this.finish(); this._host.innerHTML = html || ''; };
  AnimatedInstance.prototype.destroy = function(){ clearTimeout(this._timer); if(this._host && this._host.parentNode) this._host.parentNode.removeChild(this._host); };

  const API = {
    mount(target, opts){ if(!target) throw new Error('AnimatedReply.mount requires target element'); return new AnimatedInstance(target, opts); }
  };
  global.AnimatedReply = API;
})(window);
