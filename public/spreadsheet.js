const maxFileBytes=10_000_000;
const maxPartBytes=12_000_000;
const maxRecords=1001;
const malformed=()=>new Error('The workbook is malformed. Export it again as XLSX or CSV.');

export function parseCsv(text){
 let input=text.replace(/^\uFEFF/,'');
 const separator=/^sep=([,;\t])(?:\r\n|\r|\n)/i.exec(input);
 if(separator)input=input.slice(separator[0].length);
 const delimiter=separator?.[1]||detectDelimiter(input);
 const rows=[];
 let row=[],field='',quoted=false,closed=false;
 const cell=()=>{row.push(field);field='';closed=false;};
 const record=()=>{
  cell();
  if(row.some(value=>value.trim())){
   rows.push(row);
   if(rows.length>maxRecords)throw Error('Split the file into imports of up to 1,000 records.');
  }
  row=[];
 };
 for(let i=0;i<input.length;i++){
  const ch=input[i];
  if(quoted){
   if(ch!=='"')field+=ch;
   else if(input[i+1]==='"'){field+='"';i++;}
   else{quoted=false;closed=true;}
   continue;
  }
  if(ch===delimiter){cell();continue;}
  if(ch==='\r'||ch==='\n'){
   if(ch==='\r'&&input[i+1]==='\n')i++;
   record();continue;
  }
  if(closed){
   if(ch===' '||ch==='\t')continue;
   throw Error('Unexpected text after a closing quote in record '+(rows.length+1)+'.');
  }
  if(ch==='"'&&!field.trim()){
   field='';quoted=true;continue;
  }
  field+=ch;
 }
 if(quoted)throw Error('Unclosed quote in record '+(rows.length+1)+'.');
 record();
 return rows;
}

function detectDelimiter(text){
 const counts=new Map([[',',0],['\t',0],[';',0]]);
 let quoted=false,started=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(ch==='"'){
   if(quoted&&text[i+1]==='"'){i++;continue;}
   if(quoted||!started)quoted=!quoted;
   if(!quoted)started=true;
   continue;
  }
  if(quoted)continue;
  if(ch==='\r'||ch==='\n'){
   if(started||[...counts.values()].some(Boolean))break;
   continue;
  }
  if(counts.has(ch)){counts.set(ch,counts.get(ch)+1);started=false;}
  else if(ch.trim())started=true;
 }
 return [...counts].sort((a,b)=>b[1]-a[1])[0][0];
}

function decodeText(bytes){
 if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le',{fatal:true}).decode(bytes);
 if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder('utf-16be',{fatal:true}).decode(bytes);
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 catch{
  if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)throw Error('The file contains invalid UTF-8. Export it again as CSV UTF-8.');
  return new TextDecoder('windows-1252').decode(bytes);
 }
}

const crcTable=Uint32Array.from({length:256},(_,index)=>{
 let value=index;
 for(let i=0;i<8;i++)value=value&1?0xedb88320^(value>>>1):value>>>1;
 return value;
});
function checksum(bytes){
 let crc=0xffffffff;
 for(const byte of bytes)crc=crcTable[(crc^byte)&0xff]^(crc>>>8);
 return (crc^0xffffffff)>>>0;
}

function zipParts(buffer){
 const view=new DataView(buffer),bytes=new Uint8Array(buffer);
 const u16=offset=>view.getUint16(offset,true),u32=offset=>view.getUint32(offset,true);
 const decode=new TextDecoder('utf-8',{fatal:true});
 let end=bytes.length-22;
 while(end>=Math.max(0,bytes.length-65557)&&(u32(end)!==0x06054b50||end+22+u16(end+20)!==bytes.length))end--;
 if(end<Math.max(0,bytes.length-65557)||u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10))throw malformed();
 const entries=u16(end+10),directory=new Map();
 let offset=u32(end+16);
 if(entries>2000||offset+u32(end+12)!==end)throw malformed();
 const directoryStart=offset;
 for(let n=0;n<entries;n++){
  if(offset+46>end||u32(offset)!==0x02014b50)throw malformed();
  const nameLength=u16(offset+28),next=offset+46+nameLength+u16(offset+30)+u16(offset+32);
  if(next>end)throw malformed();
  const name=decode.decode(bytes.subarray(offset+46,offset+46+nameLength));
  if(directory.has(name))throw malformed();
  directory.set(name,{flags:u16(offset+8),method:u16(offset+10),crc:u32(offset+16),size:u32(offset+20),
   expanded:u32(offset+24),loc:u32(offset+42)});
  offset=next;
 }
 if(offset!==end)throw malformed();
 let totalExpanded=0;
 return async name=>{
  const part=directory.get(name);
  if(!part)return null;
  const {loc,flags,method,size,expanded,crc}=part;
  if(expanded>maxPartBytes||totalExpanded+expanded>24_000_000)throw Error('The worksheet expands beyond the import size limit.');
  if((flags&1)||![0,8].includes(method))throw Error('The workbook uses encryption or an unsupported compression method.');
  if(loc+30>directoryStart||u32(loc)!==0x04034b50||u16(loc+8)!==method)throw malformed();
  const nameEnd=loc+30+u16(loc+26),start=nameEnd+u16(loc+28);
  if(start+size>directoryStart||decode.decode(bytes.subarray(loc+30,nameEnd))!==name)throw malformed();
  let content=bytes.subarray(start,start+size);
  if(method===8){
   const reader=new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
   const output=new Uint8Array(expanded);
   let length=0;
   try{
    for(;;){
     const {value,done}=await reader.read();
     if(done)break;
     if(length+value.length>expanded){await reader.cancel();throw malformed();}
     output.set(value,length);length+=value.length;
    }
   }finally{reader.releaseLock();}
   if(length!==expanded)throw malformed();
   content=output;
  }
  if(content.length!==expanded||checksum(content)!==crc)throw malformed();
  totalExpanded+=expanded;
  return decodeText(content);
 };
}
const elements=(node,tag)=>[...node.getElementsByTagNameNS('*',tag)];
function xml(text,expected){
 if(!text||/<!DOCTYPE/i.test(text))throw malformed();
 const doc=new DOMParser().parseFromString(text,'application/xml');
 if(doc.documentElement?.localName!==expected||elements(doc,'parsererror').length)throw malformed();
 return doc;
}
const relationId=node=>node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||
 node.getAttributeNS('http://purl.oclc.org/ooxml/officeDocument/relationships','id')||node.getAttribute('r:id');
function relationships(text){
 if(!text)return [];
 return elements(xml(text,'Relationships'),'Relationship').map(el=>({
  id:el.getAttribute('Id'),target:el.getAttribute('Target'),type:el.getAttribute('Type')||'',external:el.getAttribute('TargetMode')==='External'
 }));
}
function partPath(from,target){
 if(!target||target.includes('\\'))throw malformed();
 const url=new URL(target,'https://workbook.invalid/'+from);
 if(url.hostname!=='workbook.invalid'||url.search||url.hash)throw malformed();
 return decodeURIComponent(url.pathname.slice(1));
}
const addressIndex=address=>{
 const match=/^([A-Z]{1,3})[1-9]\d{0,6}$/.exec(address);
 return match?[...match[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1:-1;
};
const richText=node=>elements(node,'t').filter(el=>el.parentElement?.localName!=='rPh').map(el=>el.textContent).join('');

async function worksheet(get){
 const workbookPath='xl/workbook.xml';
 const book=xml(await get(workbookPath),'workbook');
 const relations=relationships(await get('xl/_rels/workbook.xml.rels'));
 const relationship=elements(book,'sheet').map(sheet=>{
  const id=relationId(sheet),rel=relations.find(r=>r.id===id);
  if(!rel)throw malformed();
  return rel;
 }).find(rel=>!rel.type||rel.type.endsWith('/worksheet'));
 if(!relationship||relationship.external)throw Error('No readable worksheet was found.');
 const path=partPath(workbookPath,relationship.target);
 const sheet=xml(await get(path),'worksheet');
 const shared=relations.find(rel=>rel.type.endsWith('/sharedStrings'));
 if(shared?.external)throw malformed();
 const strings=await get(shared?partPath(workbookPath,shared.target):'xl/sharedStrings.xml');
 const sharedText=strings?elements(xml(strings,'sst'),'si').map(richText):[];
 const sheetLinks=elements(sheet,'hyperlink');
 const relPath=path.slice(0,path.lastIndexOf('/')+1)+'_rels/'+path.split('/').at(-1)+'.rels';
 const linkRelations=sheetLinks.length?relationships(await get(relPath)):[];
 const targets=new Map(linkRelations.filter(rel=>rel.external&&rel.type.endsWith('/hyperlink')&&/^https?:\/\//i.test(rel.target)).map(rel=>[rel.id,rel.target]));
 const hyperlinks=new Map(sheetLinks.filter(el=>targets.has(relationId(el))).map(el=>[el.getAttribute('ref'),targets.get(relationId(el))]));
 const rows=[];
 for(const row of elements(sheet,'row')){
  const cells=[],links={};
  for(const cell of elements(row,'c')){
   const address=cell.getAttribute('r');
   const col=address?addressIndex(address):cells.length;
   if(col<0||col>=16384)throw malformed();
   const type=cell.getAttribute('t'),value=elements(cell,'v')[0]?.textContent??'';
   if(type==='s'&&(!/^\d+$/.test(value)||sharedText[Number(value)]===undefined))throw malformed();
   cells[col]=type==='s'?sharedText[Number(value)]:type==='inlineStr'?richText(cell):type==='e'?'':value;
   const formula=elements(cell,'f')[0]?.textContent||'';
   const link=hyperlinks.get(address)||/^HYPERLINK\(\s*"(https?:\/\/[^"]+)"/i.exec(formula)?.[1];
   if(link)links[col]=link;
  }
  if(cells.some(value=>value.trim())||Object.keys(links).length){
   const values=Array.from(cells,value=>value??'');
   values.links=links;
   rows.push(values);
   if(rows.length>maxRecords)throw Error('Split the worksheet into imports of up to 1,000 records.');
  }
 }
 return rows;
}

export async function parseWorkbook(file){
 if(!file.size)throw Error('The file is empty.');
 if(file.size>maxFileBytes)throw Error('Choose a spreadsheet under 10 MB.');
 const extension=file.name.split('.').at(-1).toLowerCase();
 const buffer=await file.arrayBuffer();
 if(['csv','tsv','txt'].includes(extension)){
  let text;
  try{text=decodeText(new Uint8Array(buffer));}
  catch{throw Error('The text encoding is invalid. Export it again as CSV UTF-8.');}
  if(text.includes('\0'))throw Error('This file is not readable text. Export it as CSV UTF-8 or XLSX.');
  return parseCsv(text);
 }
 if(extension!=='xlsx')throw Error('Use an XLSX, CSV, TSV or text file.');
 try{return await worksheet(zipParts(buffer));}
 catch(error){
  if(error instanceof RangeError||error instanceof TypeError)throw malformed();
  throw error;
 }
}
