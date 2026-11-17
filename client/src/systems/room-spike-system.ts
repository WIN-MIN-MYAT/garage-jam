import { createSystem } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { readRoomFromFrame } from '../room-scan.js';

// Gate 3 probe. It only reports data provided by the live WebXR session.
export class RoomSpikeSystem extends createSystem({}) {
  init() {
    const shell = this.world.getSceneObject('garage-shell');
    if (shell) shell.visible = false;
    this.world.renderer.setClearColor(0x000000, 0);
    emit('status', 'Room probe: look for plane wireframes; RUN SCAN if none appear');

    let scanRequested = false;
    const requestScan = async () => {
      const capture = this.world.session?.initiateRoomCapture;
      if (!capture) { emit('status', 'Room capture is unavailable in this browser session'); return; }
      if (scanRequested) { emit('status', 'Room capture was already requested this session'); return; }
      scanRequested = true;
      emit('status', 'Requesting Space Setup room capture...');
      try { await capture.call(this.world.session); emit('status', 'Room capture request completed; checking planes'); }
      catch (error) { emit('status', `Room capture failed: ${String(error)}`); }
    };
    garageEvents.addEventListener('room-scan-request', requestScan);
    this.cleanupFuncs.push(() => garageEvents.removeEventListener('room-scan-request', requestScan));
    let manualActive = false;
    const onManualStart = () => { manualActive = true; };
    garageEvents.addEventListener('room-manual-start', onManualStart);
    this.cleanupFuncs.push(() => garageEvents.removeEventListener('room-manual-start', onManualStart));

    let lastReport = 0;
    const stop = this.world.onXRFrame(frame => {
      const now = performance.now();
      if (now - lastReport < 1000) return;
      lastReport = now;
      const planes = [...(frame.detectedPlanes ?? [])];
      const meshes = frame.detectedMeshes?.size ?? 0;
      const referenceSpace = this.world.renderer.xr.getReferenceSpace();
      const scan = referenceSpace ? readRoomFromFrame(frame, referenceSpace) : null;
      const labels = new Map<string, number>();
      const floorSize = scan ? `floor ${scan.info.floorSize.map(size => size.toFixed(2)).join(' × ')} m` : '';
      const tableHeight = scan?.room.table ? `table top ${(scan.room.table.topY - scan.room.floor.y).toFixed(2)} m` : '';
      let floors = 0, walls = 0, tables = 0;
      for (const plane of planes) {
        const label = (plane.semanticLabel || 'unlabeled').toLowerCase();
        labels.set(label, (labels.get(label) ?? 0) + 1);
        const pose = referenceSpace && frame.getPose(plane.planeSpace, referenceSpace);
        const height = pose?.transform.position.y;
        const isFloor = label.includes('floor') || (plane.orientation === 'horizontal' && height !== undefined && Math.abs(height) < 0.2);
        const isTable = label.includes('table');
        if (isFloor) floors++;
        if (isTable) tables++;
        if (plane.orientation === 'vertical' || label.includes('wall')) walls++;
      }
      const capture = typeof this.world.session?.initiateRoomCapture === 'function' ? 'available' : 'unavailable';
      if (location.hostname === 'localhost') (window as any).garageRoomSnapshot = { floors, walls, tables, planes: planes.length, meshes, floorSize, tableHeight, labels: [...labels] };
      if (manualActive) return;
      emit('status', `Room: ${floors} floor, ${walls} walls, ${tables} tables, ${planes.length} planes, ${meshes} meshes`);
      emit('room-measurements', `${floorSize || 'FLOOR SIZE UNKNOWN'}  |  ${tableHeight || 'TABLE HEIGHT UNKNOWN'}`);
      emit('stream-diagnostics', `Scan ${capture} | Labels: ${[...labels].map(([label, count]) => `${label} ${count}`).join(', ') || 'none'}`);
    });
    this.cleanupFuncs.push(stop);
  }
}
