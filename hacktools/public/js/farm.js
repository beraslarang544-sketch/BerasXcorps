import { state } from "./state.js";

const GOLD_OFF = 0x1000;
const RICE_OFF = 0x1008;
const WATER_OFF = 0x1010;
const PLANTED_OFF = 0x1018;
const SPEED_OFF = 0x1020;

export const FARM_SCHEMA = {
  package: "id.berasxcorps.farm",
  fields: [
    { id: "gold", name: "Gold", type: "i32", offset: GOLD_OFF },
    { id: "rice", name: "Beras", type: "i32", offset: RICE_OFF },
    { id: "water", name: "Air", type: "f32", offset: WATER_OFF },
    { id: "planted", name: "Tanaman", type: "i32", offset: PLANTED_OFF },
    { id: "speed", name: "Speed", type: "f32", offset: SPEED_OFF },
  ],
};

export function farmDump() {
  const buf = new ArrayBuffer(0x2000);
  const v = new DataView(buf);
  const f = state.farm;
  v.setInt32(GOLD_OFF, f.gold, true);
  v.setInt32(RICE_OFF, f.rice, true);
  v.setFloat32(WATER_OFF, f.water, true);
  v.setInt32(PLANTED_OFF, f.planted, true);
  v.setFloat32(SPEED_OFF, f.speed, true);
  // decoys so unknown-value scan has noise
  for (let i = 0; i < 32; i++) {
    v.setInt32(0x0400 + i * 8, (i * 97 + 13) % 500, true);
    v.setFloat32(0x0800 + i * 8, (i * 1.7) % 90, true);
  }
  return buf;
}

export function applyFarmFromView(view) {
  const f = state.farm;
  if (!f.frozen.gold) f.gold = view.getInt32(GOLD_OFF, true);
  if (!f.frozen.rice) f.rice = view.getInt32(RICE_OFF, true);
  if (!f.frozen.water) f.water = view.getFloat32(WATER_OFF, true);
  f.planted = view.getInt32(PLANTED_OFF, true);
  f.speed = view.getFloat32(SPEED_OFF, true);
}

export function tickFarm() {
  const f = state.farm;
  if (!f.frozen.water) f.water = Math.max(0, f.water - 0.15 * f.speed);
  if (f.water > 10 && f.planted > 0 && !f.frozen.rice) {
    f.rice += Math.max(1, Math.floor(f.planted * 0.08 * f.speed));
  }
  if (!f.frozen.gold && f.rice > 80) {
    f.rice -= 10;
    f.gold += 5;
  }
}

export function plant() {
  const f = state.farm;
  if (f.water < 8) return false;
  f.planted += 3;
  f.water -= 6;
  return true;
}

export function harvest() {
  const f = state.farm;
  const gain = f.planted * 4;
  f.rice += gain;
  f.gold += Math.floor(gain / 3);
  f.planted = Math.max(0, f.planted - 6);
  return gain;
}
