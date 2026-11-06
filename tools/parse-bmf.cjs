// Parses the official BMF 2026 PDF text (pdftotext -layout) into JSON. Dev tool only.
const fs=require('fs');
const lines=fs.readFileSync(process.argv[2],'utf8').replace(/\f/g,'\n').split('\n');
const row=/^(.*?\S)\s{2,}(\d+)\s+(\d+)\s+(\d+)\s*$/;
const out={};let pending=[];let current=null;let started=false;let inHeader=false;let lastCity=null;
for(let i=0;i<lines.length;i++){const l=lines[i].trimEnd();const t=l.trim();
  if(!started){if(/^Afghanistan|^Ägypten/.test(t))started=true;else continue;}
  if(/^Übersicht über/.test(t)){inHeader=true;continue;}
  if(inHeader){if(/^€/.test(t))inHeader=false;continue;}
  if(/^\d+$/.test(t))continue;
  if(!t){pending=[];lastCity=null;continue;}
  const m=l.match(row);
  if(m){let name=m[1].trim();const v={full:+m[2],partial:+m[3],lodging:+m[4]};
    if(/^[–-]\s*/.test(name)){const city=name.replace(/^[–-]\s*/,'');
      out[current].cities=out[current].cities||{};const key=city==='im Übrigen'?'_rest':city;
      out[current].cities[key]=v;lastCity=key;pending=[];}
    else{name=[...pending,name].join(' ');out[name]={...v};current=null;pending=[];lastCity=null;}
  }else{
    let j=i+1;while(j<lines.length&&!lines[j].trim())j++;
    if(lastCity&&lastCity!=='_rest'&&/^[–-]/.test((lines[j]||'').trim())){const c=out[current].cities;const nk=lastCity+' '+t;c[nk]=c[lastCity];delete c[lastCity];lastCity=nk;continue;}
    pending.push(t);current=pending.join(' ');out[current]=out[current]||{};lastCity=null;}
}
for(const k of Object.keys(out)){if(!out[k].full&&!out[k].cities)delete out[k];}
fs.writeFileSync(process.argv[3],JSON.stringify({year:2026,validFrom:'2026-01-01',source:'https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Lohnsteuer/2025-12-05-steuerliche-behandlung-reisekosten-2026.html',note:'Automatycznie sparsowane z oficjalnego PDF BMF (pdftotext). Przed użyciem w płacach zweryfikuj z oryginałem.',countries:out},null,1));
console.log(Object.keys(out).length,'countries');
