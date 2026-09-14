import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinates, formatRelativeUpdate, trackingLabel } from '../src/lib/tracking-presentation.ts';

test('missing coordinates do not produce a marker at zero; valid zero is preserved',()=>{
 for(const value of [null,undefined,'',' ',false,{},NaN,Infinity]) assert.equal(coordinates(value,0),null);
 assert.equal(coordinates(91,0),null);
 assert.equal(coordinates(0,181),null);
 assert.deepEqual(coordinates(0,0),{latitude:0,longitude:0});
 assert.deepEqual(coordinates('-17.39','-66.15'),{latitude:-17.39,longitude:-66.15});
});
test('pickup and delivery are distinct, with terminal order states taking priority',()=>{
 const order={orderType:'delivery',status:'ready',deliveryDispatch:{status:'active'}};
 assert.equal(trackingLabel(order),'El rider va al punto de recogida');
 assert.equal(trackingLabel({...order,deliveryDispatch:{status:'arrived'}}),'En camino a tu ubicación');
 assert.equal(trackingLabel({...order,status:'delivered'}),'Entregado');
 assert.equal(trackingLabel({...order,status:'cancelled'}),'Cancelado');
 assert.equal(trackingLabel({...order,orderType:'pickup',deliveryDispatch:undefined}),'Listo para recoger');
});
test('invalid timestamps never claim the location was updated recently',()=>{
 const now=Date.parse('2026-09-14T23:00:00Z');
 assert.equal(formatRelativeUpdate(undefined,now),'Sin señal reciente');
 assert.equal(formatRelativeUpdate('invalid',now),'Sin señal reciente');
 assert.equal(formatRelativeUpdate('2026-09-14T22:58:00Z',now),'Actualizado hace 2 min');
});
