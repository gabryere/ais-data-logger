import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const SHIPS = {
  "Tirrenia": {
    "ATHARA": "247086200",
    "JANAS": "247057100",
    "TOMMY": "247186700"
  },
  "Moby": {
    "FANTASY": "247482700",
    "WONDER": "247015400",
    "LEGACY": "247484300",
    "OTTA": "247185400",
    "AKI": "247132400",
    "ALE DUE": "247034200"
  },
  "Grimaldi": {
    "CRUISE BONARIA": "247415200",
    "CRUISE EUROPA": "247273800",
    "CRUISE SARDEGNA": "247286700"
  },
  "GNV": {
    "SPLENDID": "247136000",
    "RHAPSODY": "247362600",
    "SIRIO": "247106500"
  }
};

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function getShipPosition(mmsi) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('Timeout'));
    }, 10000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        APIKey: process.env.AIS_API_KEY,
        BoundingBoxes: [[[35, 5], [46, 20]]],
        FiltersShipMMSI: [mmsi],
        FilterMessageTypes: ['PositionReport']
      }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.MessageType === 'PositionReport') {
        const { MetaData: meta, Message: { PositionReport: report } } = msg;
        if (meta?.MMSI?.toString() === mmsi) {
          clearTimeout(timeout);
          ws.terminate();
          resolve({
            latitude: meta.latitude,
            longitude: meta.longitude,
            speed: report.Sog
          });
        }
      }
    });

    ws.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.on('close', () => clearTimeout(timeout));
  });
}

async function salvaNelDB(mmsi, nome, compagnia, pos) {
  await supabase.from('ship_positions').insert([{
    mmsi,
    nome,
    compagnia,
    lat: pos.latitude,
    lon: pos.longitude,
    speed: pos.speed,
    timestamp: new Date().toISOString()
  }]);
}

async function main() {
  for (const [compagnia, navi] of Object.entries(SHIPS)) {
    for (const [nome, mmsi] of Object.entries(navi)) {
      let tentativi = 0;
      let ricevuto = false;
      while (!ricevuto && tentativi < 10) {
        try {
          console.log(`⏳ ${nome} (${mmsi}) tentativo ${tentativi + 1}`);
          const pos = await getShipPosition(mmsi);
          console.log(`✅ ${nome}: ${pos.latitude}, ${pos.longitude} - ${pos.speed} kn`);
          await salvaNelDB(mmsi, nome, compagnia, pos);
          ricevuto = true;
        } catch (e) {
          tentativi++;
          await sleep(1000);
        }
      }
      if (!ricevuto) {
        console.warn(`❌ ${nome} (${mmsi}) dati non ricevuti`);
      }
    }
  }
}

main();
