import * as pc from "playcanvas";
import type { SurveyManifest } from "@warp-survey/contracts";

const MIN_DISTANCE = 5;
const MAX_DISTANCE = 500;
const DAMPING = 0.15;
const MIN_PITCH = -80;
const MAX_PITCH = 30;

interface CameraState {
  distance: number;
  yaw: number;
  pitch: number;
}

export class CameraController {
  private camera: pc.Entity;
  private state: CameraState;
  private targetState: CameraState;
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private lastDistance: number | null = null;

  constructor(camera: pc.Entity, manifest: SurveyManifest) {
    this.camera = camera;

    let initialState: CameraState;
    if (manifest.viewer?.defaultCamera) {
      const pos = manifest.viewer.defaultCamera.position;
      const target = manifest.viewer.defaultCamera.target;
      const dx = pos[0] - target[0];
      const dy = pos[1] - target[1];
      const dz = pos[2] - target[2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      initialState = {
        distance,
        yaw: Math.atan2(dx, dz) * (180 / Math.PI),
        pitch: Math.asin(dy / distance) * (180 / Math.PI),
      };
    } else {
      const size = Math.max(
        manifest.bounds.max[0] - manifest.bounds.min[0],
        manifest.bounds.max[1] - manifest.bounds.min[1],
        manifest.bounds.max[2] - manifest.bounds.min[2],
      );

      initialState = {
        distance: size * 1.5,
        yaw: 45,
        pitch: 30,
      };
    }

    this.state = initialState;
    this.targetState = { ...this.state };
    this.setupEventListeners();
    this.updateCamera();
  }

  private setupEventListeners(): void {
    document.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("wheel", this.onWheel, { passive: false });
    document.addEventListener("touchstart", this.onTouchStart, { passive: true });
    document.addEventListener("touchmove", this.onTouchMove, { passive: false });
    document.addEventListener("touchend", this.onTouchEnd, { passive: true });
  }

  private onMouseDown = (e: MouseEvent): void => {
    this.isDragging = true;
    this.dragStart = { x: e.clientX, y: e.clientY };
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.isDragging) return;

    const dx = e.clientX - this.dragStart.x;
    const dy = e.clientY - this.dragStart.y;

    this.targetState.yaw -= dx * 0.5;
    this.targetState.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.targetState.pitch + dy * 0.5));

    this.dragStart = { x: e.clientX, y: e.clientY };
  };

  private onMouseUp = (): void => {
    this.isDragging = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    this.targetState.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, this.targetState.distance * factor));
  };

  private onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length === 1) {
      this.isDragging = true;
      this.dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      this.isDragging = false;
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (e.touches.length === 1 && this.isDragging) {
      e.preventDefault();
      const dx = e.touches[0].clientX - this.dragStart.x;
      const dy = e.touches[0].clientY - this.dragStart.y;

      this.targetState.yaw -= dx * 0.5;
      this.targetState.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.targetState.pitch + dy * 0.5));

      this.dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (!this.lastDistance) {
        this.lastDistance = distance;
        return;
      }

      const factor = distance / this.lastDistance > 1 ? 0.9 : 1.1;
      this.targetState.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, this.targetState.distance * factor));
      this.lastDistance = distance;
    }
  };

  private onTouchEnd = (): void => {
    this.isDragging = false;
    this.lastDistance = null;
  };

  update(): void {
    this.state.yaw += (this.targetState.yaw - this.state.yaw) * DAMPING;
    this.state.pitch += (this.targetState.pitch - this.state.pitch) * DAMPING;
    this.state.distance += (this.targetState.distance - this.state.distance) * DAMPING;
    this.updateCamera();
  }

  private updateCamera(): void {
    const yawRad = (this.state.yaw * Math.PI) / 180;
    const pitchRad = (this.state.pitch * Math.PI) / 180;

    const x = this.state.distance * Math.sin(yawRad) * Math.cos(pitchRad);
    const y = this.state.distance * Math.sin(pitchRad);
    const z = this.state.distance * Math.cos(yawRad) * Math.cos(pitchRad);

    this.camera.setLocalPosition(x, y, z);
    this.camera.lookAt(0, 0, 0);
  }

  destroy(): void {
    document.removeEventListener("mousedown", this.onMouseDown);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("wheel", this.onWheel);
    document.removeEventListener("touchstart", this.onTouchStart);
    document.removeEventListener("touchmove", this.onTouchMove);
    document.removeEventListener("touchend", this.onTouchEnd);
  }
}
