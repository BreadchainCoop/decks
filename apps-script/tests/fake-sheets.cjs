const crypto = require("node:crypto");
class Sheet {
  constructor(name,values=[],gid=0){this.name=name;this.values=values;this.gid=gid;}
  getName(){return this.name;} getSheetId(){return this.gid;}
  getLastRow(){let n=this.values.length;while(n&&!this.values[n-1].some(v=>v!==""&&v!=null))n--;return n;}
  getLastColumn(){return this.values.reduce((n,r)=>Math.max(n,r.length),0);}
  getMaxRows(){return Math.max(this.maxRows||1000,this.values.length);} getMaxColumns(){return Math.max(this.maxCols||26,this.getLastColumn());}
  insertColumnsAfter(after,count){this.maxCols=this.getMaxColumns()+count;return this;}
  insertRowsAfter(after,count){this.maxRows=this.getMaxRows()+count;return this;}
  setFrozenRows(){return this;} appendRow(r){this.values.push(r.slice());return this;}
  deleteRow(r){this.values.splice(r-1,1);}
  getRange(r,c,nr=1,nc=1){
    const sh=this;
    return {
      getSheet(){return sh;},getRow(){return r;},
      getValues(){return Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>sh.values[r+i-1]?.[c+j-1]??""));},
      getDisplayValues(){return this.getValues().map(row=>row.map(v=>v instanceof Date?v.toISOString():String(v).replace(/^'=/,"=")));},
      getValue(){return this.getValues()[0][0];},
      setValues(rows){if(rows.length!==nr||rows.some(x=>x.length!==nc))throw new Error("Range dimensions differ");rows.forEach((row,i)=>row.forEach((v,j)=>{while(sh.values.length<r+i)sh.values.push([]);sh.values[r+i-1][c+j-1]=v;}));return this;},
      setValue(v){return this.setValues([[v]]);},
      setNumberFormat(){return this;},setFontWeight(){return this;},setDataValidation(){return this;},
      clearContent(){return this.setValues(Array.from({length:nr},()=>Array(nc).fill("")));}
    };
  }
}
class Book {
  constructor(id,sheets=[]){this.id=id;this.sheets=sheets;}
  getId(){return this.id;} getSheets(){return this.sheets;}
  getSheetByName(name){return this.sheets.find(s=>s.name===name)||null;}
  insertSheet(name){if(this.getSheetByName(name))throw new Error("Duplicate tab");const sh=new Sheet(name,[],this.sheets.length+100);this.sheets.push(sh);return sh;}
}
function environment(books,props={}){
  let lock=false,counter=0;const errors=[];
  const date=d=>d.toISOString().slice(0,10);
  const sandbox={Date,console:{log:console.log,error:e=>errors.push(e)},
    SpreadsheetApp:{openById:id=>{if(!books[id])throw new Error("No configured synthetic book: "+id);return books[id];},flush(){},newDataValidation:()=>({requireValueInRange(){return this;},requireValueInList(){return this;},setAllowInvalid(){return this;},build(){return this;}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{if(Buffer.byteLength(String(v))>9000)throw new Error("Property quota");props[k]=String(v);},deleteProperty:k=>{delete props[k];}})},
    LockService:{getScriptLock:()=>({tryLock:()=>{if(lock)return false;lock=true;return true;},releaseLock:()=>{if(!lock)throw new Error("Unlock without lock");lock=false;}})},
    ContentService:{MimeType:{JSON:"json"},createTextOutput:text=>({text,setMimeType(){return this;},getContentText(){return this.text;}})},
    Utilities:{DigestAlgorithm:{SHA_256:"sha256"},Charset:{UTF_8:"utf8"},computeDigest:(_,v)=>Array.from(crypto.createHash("sha256").update(v).digest(),b=>b>127?b-256:b),getUuid:()=> (++counter).toString(16).padStart(16,"0")+"a".repeat(16),formatDate:date},
    Session:{getScriptTimeZone:()=>"UTC"}
  };
  return {sandbox,props,errors,isLocked:()=>lock};
}
module.exports={Sheet,Book,environment};
