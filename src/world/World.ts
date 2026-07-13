import * as THREE from 'three/webgpu';

export type GoalDefinition = {
  center: THREE.Vector2;
  radius: number;
};

export class World {
  readonly group = new THREE.Group();
  readonly goal: GoalDefinition = {
    center: new THREE.Vector2(),
    radius: 7,
  };

  private readonly floorTexture = this.createFloorTexture();
  private readonly floor = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshStandardMaterial({
      color: '#788d54',
      map: this.floorTexture,
      roughness: 0.96,
      metalness: 0,
    }),
  );
  private readonly goalFill = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.MeshBasicMaterial({ color: '#d9b85a', transparent: true, opacity: 0.24, depthWrite: false }),
  );
  private readonly goalRing = new THREE.Mesh(
    new THREE.RingGeometry(0.88, 1, 64),
    new THREE.MeshBasicMaterial({ color: '#ffe39a', transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
  );
  private readonly rails: THREE.Mesh[];
  private readonly railGeometry = new THREE.BoxGeometry(1, 0.42, 0.46);
  private readonly railMaterial = new THREE.MeshStandardMaterial({
    color: '#30462d',
    roughness: 0.82,
    metalness: 0.02,
  });
  private extent = 46;

  constructor(scene: THREE.Scene) {
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.03;
    this.floor.receiveShadow = false;
    this.group.add(this.floor);

    this.goalFill.rotation.x = -Math.PI / 2;
    this.goalFill.position.y = 0.012;
    this.goalRing.rotation.x = -Math.PI / 2;
    this.goalRing.position.y = 0.025;
    this.group.add(this.goalFill, this.goalRing);

    this.rails = Array.from({ length: 4 }, () => new THREE.Mesh(this.railGeometry, this.railMaterial));
    for (const rail of this.rails) this.group.add(rail);

    const hemisphere = new THREE.HemisphereLight('#f7efd4', '#31402b', 1.85);
    const sun = new THREE.DirectionalLight('#fff1c0', 2.25);
    sun.position.set(-18, 32, 15);
    this.group.add(hemisphere, sun);
    scene.add(this.group);
    this.configure(this.extent);
  }

  configure(extent: number): void {
    this.extent = extent;
    const span = extent * 2;
    this.floor.scale.set(span, span, 1);
    this.floorTexture.repeat.set(Math.max(2, span / 8), Math.max(2, span / 8));

    const railThickness = 0.46;
    this.rails[0]?.scale.set(span + railThickness * 2, 1, 1);
    this.rails[1]?.scale.set(span + railThickness * 2, 1, 1);
    this.rails[2]?.scale.set(span + railThickness * 2, 1, 1);
    this.rails[3]?.scale.set(span + railThickness * 2, 1, 1);
    this.rails[0]?.position.set(0, 0.18, -extent - railThickness * 0.5);
    this.rails[1]?.position.set(0, 0.18, extent + railThickness * 0.5);
    this.rails[2]?.position.set(-extent - railThickness * 0.5, 0.18, 0);
    this.rails[3]?.position.set(extent + railThickness * 0.5, 0.18, 0);
    if (this.rails[2]) this.rails[2].rotation.y = Math.PI / 2;
    if (this.rails[3]) this.rails[3].rotation.y = Math.PI / 2;

    this.goal.radius = Math.min(12, extent * 0.18);
    this.goal.center.set(extent * 0.55, 0);
    this.goalFill.position.set(this.goal.center.x, 0.012, this.goal.center.y);
    this.goalRing.position.set(this.goal.center.x, 0.025, this.goal.center.y);
    this.goalFill.scale.setScalar(this.goal.radius);
    this.goalRing.scale.setScalar(this.goal.radius);
  }

  update(elapsed: number, holdProgress: number): void {
    const pulse = 1 + Math.sin(elapsed * 2.4) * 0.025 + holdProgress * 0.08;
    this.goalRing.scale.setScalar(this.goal.radius * pulse);
    const material = this.goalRing.material as THREE.MeshBasicMaterial;
    material.opacity = 0.72 + holdProgress * 0.25;
  }

  dispose(): void {
    this.floor.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
    this.floorTexture.dispose();
    this.goalFill.geometry.dispose();
    (this.goalFill.material as THREE.Material).dispose();
    this.goalRing.geometry.dispose();
    (this.goalRing.material as THREE.Material).dispose();
    this.railGeometry.dispose();
    this.railMaterial.dispose();
    this.group.removeFromParent();
  }

  private createFloorTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create arena texture.');
    context.fillStyle = '#778b55';
    context.fillRect(0, 0, size, size);
    context.fillStyle = 'rgba(39, 61, 35, 0.26)';
    for (let y = 0; y < size; y += 16) {
      for (let x = 0; x < size; x += 16) {
        const offset = ((x * 17 + y * 31) % 23) - 11;
        context.fillRect(x + 2, y + 5 + offset * 0.08, 8, 2);
      }
    }
    context.strokeStyle = 'rgba(245, 236, 194, 0.12)';
    context.lineWidth = 1;
    context.strokeRect(4, 4, size - 8, size - 8);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }
}
