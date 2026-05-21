// ── Color Replacer globals ──
var crMode='hsl', crFromColor='#e07020', crToColor='#20a050', crTol=25, crFeat=10;
var crOrigData=null, crGl=null, crGlCanvas=null, crEyedrop=false;
var crAlgoDescs={hsl:'Fast, predictable. Shifts Hue within ± tolerance.',lab:'Perceptual accuracy. Delta E threshold in CIELAB space.',webgl:'Real-time GPU shader — preview updates instantly as you adjust sliders.'};

function crCvs(){return document.getElementById('cr-canvas-main');}
function crMaskCvs(){return document.getElementById('cr-mask-overlay');}
function crSetStatus(t){document.getElementById('cr-status-bar').innerHTML=t;}

function crInit(){}

function crSetMode(m){
  crMode=m;
  document.querySelectorAll('.cr-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('cr-tab-'+m).classList.add('active');
  document.getElementById('cr-algo-desc').textContent=crAlgoDescs[m];
  document.getElementById('cr-tol-label').textContent=m==='lab'?'ΔE':'Hue ±';
  var tolEl=document.getElementById('cr-tol');
  var tolNv=document.getElementById('cr-tol-nv');
  if(m==='lab'){tolEl.max=80;tolNv.max=80;}
  else{tolEl.max=60;tolNv.max=60;}
  if(m==='webgl'&&crOrigData) crInitWebGL();
}

function crUpdateSwatch(sid,hid,hex){
  document.getElementById(sid).style.background=hex;
  document.getElementById(hid).textContent=hex;
}

function crToggleEyedrop(){
  crEyedrop=!crEyedrop;
  document.getElementById('cr-eyedrop-btn').classList.toggle('active',crEyedrop);
}

function crRgbToHex(r,g,b){return'#'+[r,g,b].map(function(v){return v.toString(16).padStart(2,'0');}).join('');}
function crHexToRgb(h){var n=parseInt(h.slice(1),16);return[(n>>16)&255,(n>>8)&255,n&255];}

function crRgbToHsl(r,g,b){
  r/=255;g/=255;b/=255;
  var mx=Math.max(r,g,b),mn=Math.min(r,g,b);
  var h=0,s=0,l=(mx+mn)/2;
  if(mx!==mn){var d=mx-mn;s=l>.5?d/(2-mx-mn):d/(mx+mn);
    if(mx===r)h=((g-b)/d+(g<b?6:0))/6;
    else if(mx===g)h=((b-r)/d+2)/6;
    else h=((r-g)/d+4)/6;}
  return[h*360,s,l];
}
function crHslToRgb(h,s,l){
  h/=360;
  if(s===0){var v=Math.round(l*255);return[v,v,v];}
  var q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;
  function hu(p,q,t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<.5)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}
  return[Math.round(hu(p,q,h+1/3)*255),Math.round(hu(p,q,h)*255),Math.round(hu(p,q,h-1/3)*255)];
}
function crHueDiff(a,b){var d=Math.abs(a-b);return d>180?360-d:d;}

function crRgbToLab(r,g,b){
  var R=r/255,G=g/255,B=b/255;
  R=R>.04045?Math.pow((R+.055)/1.055,2.4):R/12.92;
  G=G>.04045?Math.pow((G+.055)/1.055,2.4):G/12.92;
  B=B>.04045?Math.pow((B+.055)/1.055,2.4):B/12.92;
  var X=(R*.4124+G*.3576+B*.1805)/.95047;
  var Y=(R*.2126+G*.7152+B*.0722);
  var Z=(R*.0193+G*.1192+B*.9505)/1.08883;
  function f(t){return t>.008856?Math.cbrt(t):(7.787*t+16/116);}
  return[116*f(Y)-16,500*(f(X)-f(Y)),200*(f(Y)-f(Z))];
}
function crDeltaE(a,b){return Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2);}

function crApplyHSL(data,fc,tc,tol,feat){
  var fr=crRgbToHsl.apply(null,crHexToRgb(fc));
  var fh=fr[0],fs=fr[1];
  var tr=crRgbToHsl.apply(null,crHexToRgb(tc));
  var th=tr[0],ts=tr[1];
  var out=new Uint8ClampedArray(data);
  var maskOut=new Uint8ClampedArray(data.length);
  for(var i=0;i<data.length;i+=4){
    var hsl=crRgbToHsl(data[i],data[i+1],data[i+2]);
    var h=hsl[0],s=hsl[1],l=hsl[2];
    var diff=crHueDiff(h,fh);
    var alpha=0;
    if(diff<=tol)alpha=1;
    else if(feat>0&&diff<=tol+feat)alpha=1-(diff-tol)/feat;
    if(alpha>0){
      var delta=((th-fh+540)%360);
      var nh=(h+delta)%360;
      var nsat=Math.max(0,Math.min(1,s+(ts-fs)*alpha));
      var rgb=crHslToRgb(nh,nsat,l);
      out[i]=Math.round(data[i]+(rgb[0]-data[i])*alpha);
      out[i+1]=Math.round(data[i+1]+(rgb[1]-data[i+1])*alpha);
      out[i+2]=Math.round(data[i+2]+(rgb[2]-data[i+2])*alpha);
      var g255=Math.round(alpha*255);
      maskOut[i]=g255;maskOut[i+1]=g255;maskOut[i+2]=g255;maskOut[i+3]=220;
    }
  }
  return{out:out,maskOut:maskOut};
}

function crLabToRgb(L,a,b){
  // LAB -> XYZ
  var fy=(L+16)/116, fx=a/500+fy, fz=fy-b/200;
  var x=fx*fx*fx>.008856?fx*fx*fx:(fx-16/116)/7.787;
  var y=fy*fy*fy>.008856?fy*fy*fy:(fy-16/116)/7.787;
  var z=fz*fz*fz>.008856?fz*fz*fz:(fz-16/116)/7.787;
  x*=.95047; y*=1.0; z*=1.08883;
  // XYZ -> linear RGB
  var r= x* 3.2406+y*-1.5372+z*-0.4986;
  var g= x*-0.9689+y* 1.8758+z* 0.0415;
  var bv=x* 0.0557+y*-0.2040+z* 1.0570;
  // gamma
  function gc(v){return v>.0031308?1.055*Math.pow(v,1/2.4)-.055:12.92*v;}
  r=gc(r);g=gc(g);bv=gc(bv);
  return[Math.max(0,Math.min(255,Math.round(r*255))),
         Math.max(0,Math.min(255,Math.round(g*255))),
         Math.max(0,Math.min(255,Math.round(bv*255)))];
}

function crApplyLAB(data,fc,tc,tol,feat){
  var frgb=crHexToRgb(fc),trgb=crHexToRgb(tc);
  var flab=crRgbToLab.apply(null,frgb);
  var tlab=crRgbToLab.apply(null,trgb);
  // delta in LAB space
  var dL=tlab[0]-flab[0], da=tlab[1]-flab[1], db=tlab[2]-flab[2];
  var out=new Uint8ClampedArray(data);
  var maskOut=new Uint8ClampedArray(data.length);
  for(var i=0;i<data.length;i+=4){
    var plab=crRgbToLab(data[i],data[i+1],data[i+2]);
    var de=crDeltaE(plab,flab);
    var alpha=0;
    if(de<=tol)alpha=1;
    else if(feat>0&&de<=tol+feat)alpha=1-(de-tol)/feat;
    if(alpha>0){
      // shift LAB by delta, blended by alpha
      var nL=plab[0]+dL*alpha;
      var na=plab[1]+da*alpha;
      var nb=plab[2]+db*alpha;
      var rgb=crLabToRgb(nL,na,nb);
      out[i]=rgb[0];
      out[i+1]=rgb[1];
      out[i+2]=rgb[2];
      var g255=Math.round(alpha*255);
      maskOut[i]=g255;maskOut[i+1]=g255;maskOut[i+2]=g255;maskOut[i+3]=220;
    }
  }
  return{out:out,maskOut:maskOut};
}

function crInitWebGL(){
  if(!crOrigData)return;
  if(!crGlCanvas)crGlCanvas=document.createElement('canvas');
  var c=crCvs();
  crGlCanvas.width=c.width;crGlCanvas.height=c.height;
  crGl=crGlCanvas.getContext('webgl');
  if(!crGl){crSetStatus('<b style="color:var(--ac)">WebGL not supported</b>');return;}
  var gl=crGl;
  var vs='attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0,1);}';
  var fs='precision mediump float;uniform sampler2D tex;uniform vec3 fc;uniform vec3 tc;uniform float tol;uniform float feat;varying vec2 uv;vec3 rgb2hsl(vec3 c){float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b));float h=0.,s=0.,l=(mx+mn)*.5;if(mx!=mn){float d=mx-mn;s=l>.5?d/(2.-mx-mn):d/(mx+mn);if(mx==c.r)h=mod((c.g-c.b)/d+(c.g<c.b?6.:0.),6.)/6.;else if(mx==c.g)h=((c.b-c.r)/d+2.)/6.;else h=((c.r-c.g)/d+4.)/6.;}return vec3(h*360.,s,l);}float hq(float p,float q,float t){if(t<0.)t+=1.;if(t>1.)t-=1.;if(t<1./6.)return p+(q-p)*6.*t;if(t<.5)return q;if(t<2./3.)return p+(q-p)*(2./3.-t)*6.;return p;}vec3 hsl2rgb(vec3 hsl){float h=hsl.x/360.,s=hsl.y,l=hsl.z;if(s==0.)return vec3(l);float q=l<.5?l*(1.+s):l+s-l*s,p=2.*l-q;return vec3(hq(p,q,h+1./3.),hq(p,q,h),hq(p,q,h-1./3.));}float hueDiff(float a,float b){float d=abs(a-b);return d>180.?360.-d:d;}void main(){vec4 px=texture2D(tex,vec2(uv.x,1.-uv.y));vec3 hsl=rgb2hsl(px.rgb);vec3 fhsl=rgb2hsl(fc);vec3 thsl=rgb2hsl(tc);float diff=hueDiff(hsl.x,fhsl.x);float alpha=diff<=tol?1.:diff<=tol+feat?1.-(diff-tol)/max(feat,0.001):0.;if(alpha>0.){float delta=mod(thsl.x-fhsl.x+540.,360.);vec3 nhsl=vec3(mod(hsl.x+delta,360.),clamp(hsl.y+(thsl.y-fhsl.y)*alpha,0.,1.),hsl.z);vec3 nc=hsl2rgb(nhsl);px.rgb=mix(px.rgb,nc,alpha);}gl_FragColor=px;}';
  function mkShader(type,src){var s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);return s;}
  var prog=gl.createProgram();
  gl.attachShader(prog,mkShader(gl.VERTEX_SHADER,vs));
  gl.attachShader(prog,mkShader(gl.FRAGMENT_SHADER,fs));
  gl.linkProgram(prog);gl.useProgram(prog);
  var buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  var pos=gl.getAttribLocation(prog,'p');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
  var tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
  gl._prog=prog;
  crWebGLRender();
}

function crWebGLRender(){
  if(!crGl||!crGl._prog)return;
  var gl=crGl,prog=crGl._prog;
  function toF(h){var r=crHexToRgb(h);return[r[0]/255,r[1]/255,r[2]/255];}
  gl.uniform3fv(gl.getUniformLocation(prog,'fc'),toF(crFromColor));
  gl.uniform3fv(gl.getUniformLocation(prog,'tc'),toF(crToColor));
  gl.uniform1f(gl.getUniformLocation(prog,'tol'),crTol);
  gl.uniform1f(gl.getUniformLocation(prog,'feat'),crFeat);
  gl.viewport(0,0,crGlCanvas.width,crGlCanvas.height);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  var c=crCvs();
  c.getContext('2d').clearRect(0,0,c.width,c.height);
  c.getContext('2d').drawImage(crGlCanvas,0,0);
}

function crApply(){
  if(!crOrigData){crSetStatus('<b>Load image first</b>');return;}
  if(crMode==='webgl'){crInitWebGL();crSetStatus('<b>WebGL</b> — real-time GPU render active');return;}
  var t0=performance.now();
  var c=crCvs();
  var result=crMode==='hsl'?crApplyHSL(crOrigData.data,crFromColor,crToColor,crTol,crFeat):crApplyLAB(crOrigData.data,crFromColor,crToColor,crTol,crFeat);
  c.getContext('2d').putImageData(new ImageData(result.out,c.width,c.height),0,0);
  if(document.getElementById('cr-show-mask').checked){
    var mc=crMaskCvs();
    mc.getContext('2d').putImageData(new ImageData(result.maskOut,c.width,c.height),0,0);
  }
  var ms=(performance.now()-t0).toFixed(1);
  crSetStatus('<b>'+crMode.toUpperCase()+'</b> · '+c.width+'×'+c.height+'px · '+ms+'ms');
  document.getElementById('cr-dl-btn').disabled=false;
  if(document.getElementById('cr-show-mask').checked) crToggleMask(true);
}

function crToggleMask(show){
  var panel=document.getElementById('cr-mask-panel');
  if(!show){panel.classList.remove('visible');return;}
  panel.classList.add('visible');
  if(crOrigData){
    var c=crCvs();
    var result=crMode==='hsl'?crApplyHSL(crOrigData.data,crFromColor,crToColor,crTol,crFeat):crApplyLAB(crOrigData.data,crFromColor,crToColor,crTol,crFeat);
    var mc=crMaskCvs();
    mc.width=c.width;mc.height=c.height;
    mc.getContext('2d').putImageData(new ImageData(result.maskOut,c.width,c.height),0,0);
  }
}

function crReset(){
  if(!crOrigData)return;
  var c=crCvs();
  c.getContext('2d').putImageData(crOrigData,0,0);
  crMaskCvs().getContext('2d').clearRect(0,0,c.width,c.height);
  document.getElementById('cr-mask-panel').classList.remove('visible');
  document.getElementById('cr-show-mask').checked=false;
  crGl=null;crGlCanvas=null;
  crPanX=0;crPanY=0;crZoom=1;crApplyTransform();
  crSetStatus('Reset — showing original');
}

function crDownload(){
  if(!crOrigData)return;
  var a=document.createElement('a');a.download='color-replaced.png';a.href=crCvs().toDataURL();a.click();
}

function crLoadImage(file){
  var img=new Image();
  img.onload=function(){
    var c=crCvs();
    var mc=crMaskCvs();
    c.width=img.naturalWidth;c.height=img.naturalHeight;
    mc.width=img.naturalWidth;mc.height=img.naturalHeight;
    c.getContext('2d').drawImage(img,0,0);
    crOrigData=c.getContext('2d').getImageData(0,0,c.width,c.height);
    document.getElementById('cr-drop').style.display='none';
    document.getElementById('cr-canvas-wrap').style.display='inline-block';
    document.getElementById('cr-dl-btn').disabled=false;
    crGl=null;crGlCanvas=null;
    crPanX=0;crPanY=0;crZoom=1;
    requestAnimationFrame(function(){requestAnimationFrame(crApplyTransform);});
    crSetStatus('<b>'+file.name+'</b> · '+c.width+'×'+c.height+'px · scroll = zoom · RMB = pan · dblclick = reset');
    if(crMode==='webgl') crInitWebGL();
  };
  img.src=URL.createObjectURL(file);
}

document.getElementById('cr-file-in').addEventListener('change',function(e){
  if(e.target.files[0]) crLoadImage(e.target.files[0]);
});


// ── Pan & Zoom ──
var crPanX=0, crPanY=0, crZoom=1;
var crIsPanning=false, crLastPanX=0, crLastPanY=0;

function crApplyTransform(){
  var wrap=document.getElementById('cr-canvas-wrap');
  if(!wrap||wrap.style.display==='none') return;
  var vp=document.getElementById('cr-viewport');
  var vpW=vp.clientWidth, vpH=vp.clientHeight;
  var cW=wrap.offsetWidth, cH=wrap.offsetHeight;
  // center offset so image is in the middle of viewport
  var cx=Math.round((vpW-cW)/2);
  var cy=Math.round((vpH-cH)/2);
  wrap.style.left=cx+'px';
  wrap.style.top=cy+'px';
  wrap.style.transformOrigin='center center';
  wrap.style.transform='translate('+crPanX+'px,'+crPanY+'px) scale('+crZoom+')';
}

(function(){
  var vp=document.getElementById('cr-viewport');
  if(!vp) return;

  vp.addEventListener('wheel',function(e){
    e.preventDefault();
    var rect=vp.getBoundingClientRect();
    var wrap=document.getElementById('cr-canvas-wrap');
    if(!wrap||wrap.style.display==='none') return;
    // mouse position relative to wrap center
    var wRect=wrap.getBoundingClientRect();
    var wCx=wRect.left+wRect.width/2;
    var wCy=wRect.top+wRect.height/2;
    var mx=e.clientX-wCx;
    var my=e.clientY-wCy;
    var factor=e.deltaY<0?1.12:1/1.12;
    var newZoom=Math.max(0.1,Math.min(30,crZoom*factor));
    var scale=newZoom/crZoom;
    crPanX=crPanX+mx*(1-scale);
    crPanY=crPanY+my*(1-scale);
    crZoom=newZoom;
    crApplyTransform();
  },{passive:false});

  vp.addEventListener('mousedown',function(e){
    if(e.button===2){
      e.preventDefault();
      crIsPanning=true;
      crLastPanX=e.clientX;
      crLastPanY=e.clientY;
      vp.style.cursor='grabbing';
    }
  });

  window.addEventListener('mousemove',function(e){
    if(!crIsPanning)return;
    crPanX+=e.clientX-crLastPanX;
    crPanY+=e.clientY-crLastPanY;
    crLastPanX=e.clientX;
    crLastPanY=e.clientY;
    crApplyTransform();
  });

  window.addEventListener('mouseup',function(e){
    if(e.button===2&&crIsPanning){
      crIsPanning=false;
      vp.style.cursor='';
    }
  });

  vp.addEventListener('contextmenu',function(e){e.preventDefault();});

  vp.addEventListener('dblclick',function(e){
    if(e.button===0&&!crEyedrop){
      crPanX=0;crPanY=0;crZoom=1;crApplyTransform();
    }
  });
})();

(function(){
  var dz=document.getElementById('cr-drop-zone');
  dz.addEventListener('dragover',function(e){e.preventDefault();document.getElementById('cr-drop').classList.add('over');});
  dz.addEventListener('dragleave',function(){document.getElementById('cr-drop').classList.remove('over');});
  dz.addEventListener('drop',function(e){
    e.preventDefault();
    document.getElementById('cr-drop').classList.remove('over');
    var f=e.dataTransfer.files[0];
    if(f&&f.type.startsWith('image/'))crLoadImage(f);
  });
  document.getElementById('cr-canvas-main').addEventListener('click',function(e){
    if(!crEyedrop||!crOrigData)return;
    var c=crCvs();
    // account for pan/zoom: pixel coords = (mouse - pan) / zoom, then scale to canvas native size
    var vp=document.getElementById('cr-viewport');
    var vpRect=vp.getBoundingClientRect();
    var mx=e.clientX-vpRect.left;
    var my=e.clientY-vpRect.top;
    var wrap=document.getElementById('cr-canvas-wrap');
    var wRect=wrap.getBoundingClientRect();
    // position within the actual canvas element (in screen px)
    var cx=e.clientX-wRect.left;
    var cy=e.clientY-wRect.top;
    // scale to canvas native pixels
    var sx=Math.round(cx*c.width/wRect.width);
    var sy=Math.round(cy*c.height/wRect.height);
    sx=Math.max(0,Math.min(c.width-1,sx));
    sy=Math.max(0,Math.min(c.height-1,sy));
    var idx=(sy*c.width+sx)*4;
    var d=crOrigData.data;
    var hex=crRgbToHex(d[idx],d[idx+1],d[idx+2]);
    crFromColor=hex;
    document.getElementById('cr-from-cp').value=hex;
    crUpdateSwatch('cr-from-swatch','cr-from-hex',hex);
    crEyedrop=false;
    document.getElementById('cr-eyedrop-btn').classList.remove('active');
    if(crMode==='webgl') crWebGLRender();
  });
})();
