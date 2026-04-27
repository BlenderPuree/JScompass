'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './compass.module.css';

// ── Haversine bearing ──────────────────────────────────────────────────────
function calcBearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function calcDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Geocode via Nominatim (free, no key) ──────────────────────────────────
async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    query
  )}&format=json&limit=1`;
  const r = await fetch(url, {
    headers: { 'Accept-Language': 'en', 'User-Agent': 'SmartCompass/1.0' },
  });
  const data = await r.json();
  if (!data.length) throw new Error('Location not found');
  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    name: data[0].display_name,
  };
}

// ── Tick marks SVG ────────────────────────────────────────────────────────
function TicksSVG() {
  const ticks = [];
  for (let i = 0; i < 72; i++) {
    const angle = (i * 5 * Math.PI) / 180;
    const isMajor = i % 9 === 0;
    const isMed = i % 3 === 0;
    const r1 = 125;
    const r2 = isMajor ? 108 : isMed ? 113 : 118;
    const x1 = 135 + r1 * Math.sin(angle);
    const y1 = 135 - r1 * Math.cos(angle);
    const x2 = 135 + r2 * Math.sin(angle);
    const y2 = 135 - r2 * Math.cos(angle);
    ticks.push(
      <line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={
          isMajor
            ? 'rgba(232,188,92,0.7)'
            : isMed
            ? 'rgba(201,148,58,0.4)'
            : 'rgba(201,148,58,0.2)'
        }
        strokeWidth={isMajor ? 1.5 : 0.8}
      />
    );
  }
  return (
    <svg className={styles.ticksSvg} viewBox="0 0 270 270">
      {ticks}
    </svg>
  );
}

// ── Main Component ────────────────────────────────────────────────────────
export default function Compass() {
  const [destination, setDestination] = useState('');
  const [status, setStatus] = useState({
    msg: 'Enter a destination to begin your voyage',
    type: '',
  });
  const [bearing, setBearing] = useState(0);
  const [distance, setDistance] = useState(null);
  const [destCoords, setDestCoords] = useState(null);
  const [destName, setDestName] = useState('');
  const [heading, setHeading] = useState(0);
  const [loading, setLoading] = useState(false);
  const [btConnected, setBtConnected] = useState(false);
  const [locked, setLocked] = useState(false);
  const [showFirmware, setShowFirmware] = useState(false);
  const btRef = useRef(null);
  const charRef = useRef(null);
  const posRef = useRef(null);

  // Device orientation
  useEffect(() => {
    const handler = (e) => {
      if (e.webkitCompassHeading != null) {
        setHeading(e.webkitCompassHeading);
      } else if (e.alpha != null) {
        setHeading((360 - e.alpha) % 360);
      }
    };
    if (typeof DeviceOrientationEvent !== 'undefined') {
      window.addEventListener('deviceorientationabsolute', handler, true);
      window.addEventListener('deviceorientation', handler, true);
    }
    return () => {
      window.removeEventListener('deviceorientationabsolute', handler, true);
      window.removeEventListener('deviceorientation', handler, true);
    };
  }, []);

  // Watch position when dest is set
  useEffect(() => {
    if (!destCoords) return;
    const id = navigator.geolocation?.watchPosition(
      (pos) => {
        posRef.current = pos.coords;
        const b = calcBearing(
          pos.coords.latitude,
          pos.coords.longitude,
          destCoords.lat,
          destCoords.lon
        );
        const d = calcDistance(
          pos.coords.latitude,
          pos.coords.longitude,
          destCoords.lat,
          destCoords.lon
        );
        setBearing(b);
        setDistance(d);
        if (charRef.current) {
          const buf = new Uint8Array([Math.round(b) >> 8, Math.round(b) & 0xff]);
          charRef.current.writeValue(buf).catch(() => {});
        }
      },
      () => {},
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation?.clearWatch(id);
  }, [destCoords]);

  const handleNavigate = useCallback(async () => {
    if (!destination.trim()) return;
    setLoading(true);
    setStatus({ msg: 'Charting course...', type: '' });
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation
          ? navigator.geolocation.getCurrentPosition(res, rej, {
              enableHighAccuracy: true,
            })
          : rej(new Error('Geolocation not available'))
      );
      posRef.current = pos.coords;
      setStatus({ msg: 'Geocoding destination...', type: '' });
      const dest = await geocode(destination);
      setDestCoords(dest);
      const b = calcBearing(
        pos.coords.latitude,
        pos.coords.longitude,
        dest.lat,
        dest.lon
      );
      const d = calcDistance(
        pos.coords.latitude,
        pos.coords.longitude,
        dest.lat,
        dest.lon
      );
      setBearing(b);
      setDistance(d);
      setDestName(dest.name.split(',').slice(0, 3).join(', '));
      setLocked(true);
      setStatus({ msg: `Bearing locked · ${d.toFixed(1)} km away`, type: 'ok' });
    } catch (e) {
      setStatus({ msg: e.message || 'Failed to chart course', type: 'err' });
      setLocked(false);
    }
    setLoading(false);
  }, [destination]);

  const handleBluetooth = useCallback(async () => {
    if (!navigator.bluetooth) {
      setStatus({ msg: 'Web Bluetooth not supported on this browser', type: 'err' });
      return;
    }
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'SmartCompass' }],
        optionalServices: ['12345678-1234-1234-1234-123456789abc'],
      });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(
        '12345678-1234-1234-1234-123456789abc'
      );
      const char = await service.getCharacteristic(
        '12345678-1234-1234-1234-123456789abd'
      );
      charRef.current = char;
      btRef.current = device;
      setBtConnected(true);
      setStatus({ msg: 'Compass hardware connected', type: 'ok' });
      device.addEventListener('gattserverdisconnected', () => {
        setBtConnected(false);
        charRef.current = null;
        setStatus({ msg: 'Hardware disconnected', type: 'err' });
      });
    } catch (e) {
      if (e.name !== 'NotFoundError') {
        setStatus({ msg: 'Bluetooth error: ' + e.message, type: 'err' });
      }
    }
  }, []);

  const needleAngle = bearing - heading;
  const displayDist = distance
    ? distance >= 1
      ? `${distance.toFixed(1)}`
      : `${(distance * 1000).toFixed(0)}`
    : '—';
  const distUnit = distance ? (distance >= 1 ? 'km' : 'm') : '';

  return (
    <div className={styles.app}>
      <div className={styles.stars} />
      <div className={styles.grain} />

      <header className={styles.header}>
        <h1>PATHFINDER</h1>
        <p>Smart Navigation Compass</p>
      </header>

      {/* Search */}
      <div className={styles.searchWrap}>
        <label>Set your destination</label>
        <div className={styles.searchRow}>
          <input
            type="text"
            placeholder="e.g. Eiffel Tower, Paris..."
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
          />
          <button
            className={styles.btn}
            onClick={handleNavigate}
            disabled={loading}
          >
            {loading ? '...' : 'Chart'}
          </button>
        </div>
        <div
          className={`${styles.statusLine} ${
            status.type === 'ok'
              ? styles.ok
              : status.type === 'err'
              ? styles.err
              : ''
          }`}
        >
          {status.msg}
        </div>
      </div>

      {/* Compass */}
      <div className={styles.compassStage}>
        <div className={`${styles.compassOuter} ${locked ? styles.locked : ''}`}>
          <div className={styles.compassMid}>
            <TicksSVG />

            {/* Rotating rose */}
            <svg
              className={styles.compassRose}
              viewBox="0 0 270 270"
              style={{ transform: `rotate(${-heading}deg)` }}
            >
              {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
                const rad = (a * Math.PI) / 180;
                return (
                  <line
                    key={a}
                    x1={135}
                    y1={135}
                    x2={135 + 100 * Math.sin(rad)}
                    y2={135 - 100 * Math.cos(rad)}
                    stroke="rgba(201,148,58,0.08)"
                    strokeWidth="1"
                  />
                );
              })}
              <circle
                cx="135"
                cy="135"
                r="50"
                fill="none"
                stroke="rgba(201,148,58,0.07)"
                strokeWidth="1"
              />
              <circle
                cx="135"
                cy="135"
                r="80"
                fill="none"
                stroke="rgba(201,148,58,0.05)"
                strokeWidth="1"
              />
            </svg>

            {/* Cardinals */}
            <div className={`${styles.cardinal} ${styles.cN}`}>N</div>
            <div className={`${styles.cardinal} ${styles.cS}`}>S</div>
            <div className={`${styles.cardinal} ${styles.cE}`}>E</div>
            <div className={`${styles.cardinal} ${styles.cW}`}>W</div>

            {/* Destination needle (gold) */}
            <div
              className={styles.destNeedleWrap}
              style={{ transform: `rotate(${needleAngle}deg)` }}
            >
              <div className={styles.destNeedle}>
                <div
                  className={`${styles.destNeedlePoint} ${
                    locked ? styles.visible : ''
                  }`}
                />
                <div className={styles.destNeedleTail} />
              </div>
            </div>

            {/* Magnetic north needle */}
            <div
              className={styles.needleWrap}
              style={{ transform: `rotate(${-heading}deg)` }}
            >
              <div className={styles.needle}>
                <div className={styles.needleNorth} />
                <div className={styles.needleSouth} />
              </div>
              <div className={styles.needleCap} />
            </div>
          </div>
        </div>
      </div>

      {/* Destination name */}
      <div className={`${styles.destName} ${locked ? styles.visible : ''}`}>
        ✦ {destName} ✦
      </div>

      {/* Info cards */}
      <div className={styles.infoPanel}>
        <div className={styles.infoCard}>
          <div className={styles.label}>Bearing</div>
          <div className={styles.value}>
            {locked ? Math.round(bearing) : '—'}
            {locked && <span className={styles.unit}>°</span>}
          </div>
        </div>
        <div className={styles.infoCard}>
          <div className={styles.label}>Distance</div>
          <div className={styles.value}>
            {displayDist}
            {distUnit && <span className={styles.unit}>{distUnit}</span>}
          </div>
        </div>
        <div className={styles.infoCard}>
          <div className={styles.label}>Heading</div>
          <div className={styles.value}>
            {Math.round(heading)}
            <span className={styles.unit}>°</span>
          </div>
        </div>
        <div className={styles.infoCard}>
          <div className={styles.label}>Hardware</div>
          <div className={styles.value} style={{ fontSize: 14, paddingTop: 4 }}>
            {btConnected ? (
              <span style={{ color: '#7ecfb0' }}>● Connected</span>
            ) : (
              <span style={{ color: 'rgba(242,232,213,0.25)' }}>○ None</span>
            )}
          </div>
        </div>
      </div>

      <div className={styles.divider} />

      {/* Bluetooth + Firmware */}
      <div className={styles.btWrap}>
        <button
          className={`${styles.btBtn} ${btConnected ? styles.connected : ''}`}
          onClick={handleBluetooth}
        >
          {btConnected && <span className={styles.btIndicator} />}
          {btConnected
            ? 'Compass Connected via Bluetooth'
            : '⬡  Connect Physical Compass'}
        </button>

        <div className={styles.firmwareBox}>
          <div
            className={styles.firmwareHeader}
            onClick={() => setShowFirmware((v) => !v)}
          >
            <span>ESP32 Firmware Sketch</span>
            <span>{showFirmware ? '▲ hide' : '▼ view'}</span>
          </div>
          {showFirmware && (
            <div className={styles.firmwareBody}>
              <pre>{`// SmartCompass ESP32 Firmware
// Board: ESP32-C3 Mini | Arduino IDE

#include <BLEDevice.h>
#include <ESP32Servo.h>
#include <QMC5883LCompass.h>

#define SERVO_PIN 5
#define SERVICE_UUID  "12345678-1234-1234-1234-123456789abc"
#define CHAR_UUID     "12345678-1234-1234-1234-123456789abd"

Servo needle;
QMC5883LCompass compass;
float targetBearing = 0;

class BearingCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) {
    uint8_t* d = c->getData();
    targetBearing = (d[0] << 8 | d[1]);
  }
};

void setup() {
  compass.init();
  needle.attach(SERVO_PIN);
  BLEDevice::init("SmartCompass");
  // ... BLE setup ...
}

void loop() {
  compass.read();
  float heading = compass.getAzimuth();
  float angle = fmod(targetBearing - heading + 360, 360);
  // Smooth servo movement
  needle.write(angle > 180 ? angle - 360 : angle);
  delay(50);
}`}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
