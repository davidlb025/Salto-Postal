const drawings={
  saw(c) {
    c.save();
    c.translate(18,12);
    c.beginPath();
    for (let i=0;i<32;i++) {
      const a=i*Math.PI/16;
      const r=i%2?8:11;
      c.lineTo(Math.cos(a)*r,Math.sin(a)*r);
    }
    c.closePath();
    c.strokeStyle='#192037';
    c.lineWidth=2;
    c.stroke();
    c.fillStyle='#dae2d1';
    c.fill();
    c.fillStyle='#56707f';
    c.fillRect(-5,-5,10,10);
    c.fillStyle='#f8cd6b';
    c.fillRect(-2,-2,4,4);
    c.restore();
  },
  laser(c,fill) {
    fill('#152037',2,5,31,16);fill('#6ab3bd',4,6,20,13);
    fill('#abcfd4',5,6,12,4);fill('#314656',5,15,18,4);
    fill('#ac595f',23,8,10,10);fill('#ffcf7c',27,10,7,5);
  },
  mine(c,fill) {
    fill('#222236',2,16,32,6);fill('#ba7743',6,8,24,11);
    fill('#efb35e',9,5,18,8);fill('#feda88',13,4,11,3);
    fill('#442637',16,7,6,4);fill('#fb8563',18,8,3,2);
  },
  shock(c,fill) {
    fill('#202536',1,16,34,6);fill('#445979',3,14,30,5);
    for (const x of [5,24]) {
      fill('#213142',x,5,7,12);fill('#95d9d6',x-2,7,11,3);fill('#cfedf3',x,4,7,3);
    }
    fill('#fcc36f',15,16,6,2);
  },
  pendulum(c,fill) {
    fill('#202335',7,1,22,4);fill('#161f33',4,5,28,16);fill('#161f33',10,21,16,2);
    fill('#686d87',6,6,24,13);fill('#9596b0',8,6,19,3);
    fill('#dc8a4e',7,12,22,4);fill('#ecd08a',12,12,7,4);
  },
  shutter(c,fill) {
    fill('#202939',1,8,34,12);fill('#80575c',3,9,30,8);
    fill('#dca16b',4,9,28,3);fill('#ba7961',5,17,27,2);
    for (let x=6;x<30;x+=7) fill('#4e3549',x,12,4,3);
  },
  belt(c,fill) {
    fill('#1c2837',1,5,34,15);fill('#9bb894',2,6,32,4);
    fill('#406764',3,10,30,8);
    for (let x=5;x<31;x+=7) {
      fill('#b9da8c',x,11,4,4);fill('#78977a',x+2,13,3,4);
    }
  },
  gel(c,fill) {
    fill('#1d2837',1,9,34,12);fill('#335e58',2,11,32,8);
    fill('#67a775',3,6,27,6);fill('#84c986',4,5,11,3);
    fill('#b7dc99',7,5,8,2);fill('#50a277',25,7,8,5);
  },
};

const tiles=new Map();
function tile(kind) {
  if (!drawings[kind]) return null;
  if (!tiles.has(kind)) {
    const art=document.createElement('canvas');
    art.width=36;
    art.height=24;
    const ctx=art.getContext('2d');
    drawings[kind](ctx,(color,x,y,w,h)=>{
      ctx.fillStyle=color;
      ctx.fillRect(x,y,w,h);
    });
    tiles.set(kind,{art,url:art.toDataURL()});
  }
  return tiles.get(kind);
}

export function pieceURL(kind) {
  return tile(kind)?.url??'./assets/'+kind+'.png';
}

export function drawProp(ctx,kind,x,y,w,h) {
  const art=tile(kind)?.art;
  if (!art) return false;
  ctx.drawImage(art,Math.round(x),Math.round(y),Math.round(w),Math.round(h));
  return true;
}
