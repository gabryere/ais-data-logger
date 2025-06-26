// update.js

require('dotenv').config();
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const AIS_API_KEY = process.env.AIS_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ships = [
  { name: 'ATHARA', mmsi: '247086200', company: 'Tirrenia' },
  { name: 'JANAS', mmsi: '247057100', company: 'Tirrenia' },
  { name: 'TOMMY', mmsi: '247186700', company: 'Tirrenia' },
  { name: 'FANTASY', mmsi: '247482700', company: 'Moby' },
  { name: 'WONDER', mmsi: '247015400', company: 'Moby' },
  { name: 'LEGACY', mmsi: '247484300', company: 'Moby' },
  { name: 'OTTA', mmsi: '247185400', company: 'Moby' },
  { name: 'AKI', mmsi: '247132400', company: 'Moby' },
  { name: 'ALE DUE', mmsi: '247034200', company: 'Moby' },
  { name: 'CRUISE BONARIA', mmsi: '247415200', company: 'Grimaldi' },
  { name: 'CRUISE EUROPA', mmsi: '247273800', company: 'Grimaldi' },
  { name: 'CRUISE SARDEGNA', mmsi: '247286700', company: 'Grimaldi' },
  { name: 'SPLENDID', mmsi: '247136000', company: 'GNV' },
  { name: 'RHAPSODY', mmsi: '247362600', company: 'GNV' },
  { name: 'SIRIO', mmsi: '247106500', company: 'GNV' }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPosition(mmsi) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

    const timeout = setTimeout(() => {
      ws.terminate();
      reject('Timeout');
    }, 5000); // ridotto da 10s a 5s

    ws.on('open', () => {
      const msg = {
        APIKey: AIS_API_KEY,
        BoundingBoxes: [[[35, 5], [46, 20]]],
        FiltersShipMMSI: [mmsi],
        FilterMessageTypes: ['PositionReport']
      };
      ws.send(JSON.stringify(msg));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.MessageType === 'PositionReport') {
          const { latitude, longitude } = msg.MetaData;
          const speed = msg.Message.PositionReport.Sog;
          clearTimeout(timeout);
          ws.terminate();
          resolve({ latitude, longitude, speed });
        }
      } catch (err) {
        reject(err);
      }
    });

    ws.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function updateSupabase(ship, data) {
  const result = await supabase.from('navi').upsert({
    nome: ship.name,
    compagnia: ship.company,
    mmsi: ship.mmsi,
    latitudine: data.latitude,
    longitudine: data.longitude,
    velocita: data.speed,
    aggiornato_il: new Date().toISOString()
  }, { onConflict: ['mmsi'] });

  if (result.error) {
    console.error(`Errore Supabase per ${ship.name}:`, result.error.message);
  }
}

async function initializeShips() {
  for (const ship of ships) {
    await supabase.from('navi').upsert({
      nome: ship.name,
      compagnia: ship.company,
      mmsi: ship.mmsi
    }, { onConflict: ['mmsi'] });
  }
}

async function updateAll() {
  await initializeShips();

  for (const ship of ships) {
    let data = null;
    let tentativi = 0;

    while (!data && tentativi < 4) { // da 10 → 4 tentativi
      try {
        console.log(`Tentativo ${tentativi + 1} per ${ship.name}`);
        data = await fetchPosition(ship.mmsi);
        if (data) {
          await updateSupabase(ship, data);
          console.log(`Aggiornato ${ship.name}`);
        }
      } catch (e) {
        console.warn(`Errore per ${ship.name}:`, e);
        await sleep(4000); // pausa ridotta da 10s → 4s
      }
      tentativi++;
    }
  }
}

updateAll();
