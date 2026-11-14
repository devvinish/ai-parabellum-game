// AI Parabellum campaign: every mission is a block of data plus a build() that dresses the map.
// Coordinates are metres. The player starts near z = 0 facing north (-z); the AI comes from the north.
// build(c) receives the helpers made in game.js (place, block, box, circle, fire, mat, tick ...).

const city = {
  id: 'city', n: 1, name: 'Fallen City', sub: '02:14 · AI CONTROLLED DISTRICT',
  brief: 'The AI took the city in one night. You hold a captured striker at the south end of the main street. Push north, break their patrols, and when one of their machines overheats, climb in and make it yours.',
  sky: {hdr: 'night', bg: 0.07, env: 0.45}, fog: [0x0d131c, 0.0085], exposure: 1,
  sun: {color: 0x9db4e0, power: 1.5, dir: [-35, 70, 25]}, hemi: [0x3a4a66, 0x0b0907, 0.6],
  weather: 'rain', lightning: true, headlight: 260,
  ground: {tex: 'asphalt_02', repeat: 110, color: 0x8a8a8a, rough: 0.42, metal: 0.05, size: 640, at: [7, -60]},
  tex: ['asphalt_02', 'cracked_concrete_wall'],
  assets: ['city', 'ruins', 'police_cars', 'mech_heavy', 'road_barrier', 'barrel', 'crate'],
  bounds: {x0: -46, x1: 60, z0: -130, z1: 7},
  boxes: [{x0: -60, x1: 0.6, z0: -32, z1: 12, h: 13}, {x0: 14.8, x1: 80, z0: -39.5, z1: 12, h: 26}],
  grid: [[[-46, -130], [60, -130]], [[-46, -130], [-46, -32]], [[60, -130], [60, -39.5]], [[0.6, 7], [14.8, 7]]],
  start: [7.5, -4, Math.PI], rally: [8, -60], survivalStart: [8, -66],
  survival: {
    droids: [[-30, -60], [-34, -76], [-30, -96], [-20, -112], [-4, -118], [14, -116], [30, -118], [44, -104], [48, -84], [46, -62], [26, -50], [-12, -48], [0, -100], [20, -92]],
    mechs: [[-38, -122], [8, -124], [52, -120], [-40, -84], [54, -74]], titan: [8, -124], face: [8, -70],
  },
  waves: [
    {obj: ['Clear the street', 'Androids and one AI striker hold the road'], hint: 'Aim with the mouse, fire the arm cannons with left click. Rockets on right click or Q.',
      droids: [['cyborg', 4.2, -27.5], ['cyborg', 11.4, -28.5], ['cyborg', 3.4, -31], ['cyborg', 12.0, -32.5], ['biped', 5.2, -35], ['biped', 11.0, -37]], strikers: [[8, -78, 0]]},
    {banner: ['WAVE 2', 'STRIKER SQUAD INBOUND'], obj: ['Break the striker squad', 'Push into the square'],
      droids: [['biped', -12, -60], ['cyborg', -8, -64], ['cyborg', 27, -58], ['biped', 32, -63], ['cyborg', 6, -86], ['cyborg', 10, -86.5]], strikers: [[-14, -116, 0], [10, -122, 9], [32, -114, 18]]},
    {banner: ['TITAN INBOUND', 'BRING IT DOWN'], obj: ['Bring down the Titan', 'Overheat its core, then take it or finish it'],
      titans: [[10, -124, 0]], strikers: [[-24, -118, 8], [38, -112, 20]]},
  ],
  win: {destroy: ['THE DISTRICT IS OURS', 'You destroyed the Titan. The AI lost Fallen City.'], hijack: 'You turned their Titan against them. Fallen City is yours.'},
  build(c) {
    const {THREE, A, scene, V3} = c;
    const city = A.city.scene; c.prep(city); scene.add(city);
    const HIDE = ['wall', 'wall.001', 'wall.002', 'wall.003'];
    let cards = null;
    city.traverse(o => {
      if (!o.isMesh) return; const m = o.material, n = (m.name || '').toLowerCase();
      if (n.startsWith('route') || n.startsWith('trottoir')) { m.roughness = Math.min(m.roughness ?? 1, 0.45); m.envMapIntensity = 1.2; }
      if (n.includes('gravas') || n.includes('paves')) { m.color.multiplyScalar(0.75); m.roughness = 0.85; m.envMapIntensity = 1.6; m.side = THREE.DoubleSide; }
      if (n.includes('glass')) { m.transparent = true; m.opacity = 0.35; }
      if (n === 'monticule') { m.color.multiplyScalar(0.42); m.roughness = 0.5; }
      if (n.startsWith('wall.buidings')) cards = o;
      if (HIDE.includes(n) || /plants0052|plants0005|plants0038|metalfences0005|roadsbarriers0011/.test(n)) o.visible = false;
      if (/plants|ivy-leaves|grass/.test(n)) { m.alphaTest = 0.5; m.transparent = false; m.side = THREE.DoubleSide; m.color.multiplyScalar(0.7); }
    });
    // the city is a film set: photo facades on flat cards. Give each one a real building behind it.
    if (cards) c.dropCards(cards, [[6.8, 7.3, 11.9, 20.6]]); // a lone card in the street behind the start
    c.block(-24, -3.85, -30.4, 3.2, 12.3, {solid: false});
    c.block(23.45, 32.0, -39.0, 3.2, 23.7, {solid: false});
    // close the city in: buildings on every side just outside the defense grid, so no camera angle shows the edge of the set
    const seg = (x0, x1, z0, z1, n, hs, alongX) => { const out = []; for (let i = 0; i < n; i++) { const a = i / n, b = (i + 1) / n, h = hs[i % hs.length];
      out.push(alongX ? [x0 + (x1 - x0) * a, x0 + (x1 - x0) * b, z0, z1, h] : [x0, x1, z0 + (z1 - z0) * a, z0 + (z1 - z0) * b, h]); } return out; };
    c.ring([
      ...seg(-64, 0.45, 3.6, 28, 4, [13, 18, 11, 16], true), [0.45, 14.45, 9, 28, 17], ...seg(14.45, 80, 3.6, 28, 4, [21, 15, 24, 18], true),
      ...seg(-66, -48, -150, -32, 8, [14, 20, 12, 17, 22, 13, 18, 15], false),
      ...seg(62, 80, -150, -41, 7, [19, 13, 23, 16, 12, 20, 17], false),
      ...seg(-48, 62, -150, -132, 7, [16, 24, 13, 19, 26, 15, 21], true),
    ]);
    // windowed fronts over the bare ends of the two street facades that face the start
    c.block(-24, 0.45, 3.2, 3.6, 12.3, {solid: false}); c.block(14.45, 32.0, 3.2, 3.6, 23.7, {solid: false});
    c.block(-24, 0.45, -31.6, -30.4, 12.3, {solid: false}); c.block(14.45, 32.0, -39.5, -38.3, 23.7, {solid: false}); // and their north ends
    c.block(21.75, 29.5, -70.1, -62, 10.3);
    c.block(15.4, 23.4, -49.2, -41.7, 16.8);
    c.block(-12, -4.05, -51.1, -48.5, 12.3);

    // ruined towers close the square in on three sides
    c.prep(A.ruins.scene, {cast: false}); const ru = c.fit(A.ruins.scene, 47);
    ru.position.set(10, -1.5, -215); scene.add(ru);
    const r2 = ru.clone(); r2.position.set(-215, -1.5, -95); r2.rotation.y = 1.7; scene.add(r2);
    const r3 = ru.clone(); r3.position.set(230, -1.5, -95); r3.rotation.y = -1.4; scene.add(r3);

    // wrecks, cover and fires across the street and the square
    for (const [x, z, r, f] of [[2.6, -27, 1.35, 1.2], [-14, -50, 0.4, 0.9], [25, -75, 2.1, 0], [-26, -90, -0.6, 1.0], [19, -100, 1.0, 0.8], [40, -52, -1.1, 0]]) {
      c.place('police_cars', 1.9, x, z, {rot: r, solid: false}); c.circle(x, z, 2.6); if (f) c.fire(x - 0.2, 0.6, z + 1, f);
    }
    for (const [x, z, r] of [[4.6, -4.2, 0.05], [7.4, -4.5, -0.08], [10.6, -4.0, 0.2], [1.6, -19, 1.3], [11.6, -36, -0.4], [-4, -54, 0.1], [-1, -54.4, 0.05], [2, -54.2, -0.1], [12, -58, 0.3], [15, -58.6, 0.2], [30, -80, 1.4], [30.3, -83, 1.5], [-18, -70, -0.9], [-20, -72, -1.0], [6, -88, 0.0], [9, -88, 0.1]])
      c.place('road_barrier', 1.0, x, z, {rot: r, y: -0.12, solid: false});
    for (const [x, z] of [[9.4, -3.1], [10.1, -2.5], [1.2, -22.5], [-3, -56], [13, -60], [28, -78], [-16, -68], [-15.2, -68.6]]) c.place('barrel', 0.95, x, z, {rot: x, y: -0.1, solid: false});
    for (const [x, z, r] of [[5.6, -3.0, 0.3], [6.2, -2.8, -0.2], [16, -57, 0.4], [-19, -73, 1.1]]) c.place('crate', 0.32, x, z, {rot: r, y: -0.1, solid: false});
    c.fire(3.2, 0.5, -29.5, 0.8); c.fire(-30, 0.4, -110, 1.6); c.fire(44, 0.4, -96, 1.3);

    // the human cockpit mech left in the street, hatch open
    c.cockpitMech('mech_heavy', 2.4, -12.5, 0.9, {keep: 0.35, dark: 1.25}, 0xffd2a0, [9.5, 7.5, -6]);
    c.deadStriker(-6, -74, 2.2);
  },
};

const desert = {
  id: 'desert', n: 2, name: 'Desert Air Base', sub: '18:40 · AI FORWARD AIRFIELD',
  brief: 'The AI turned an old air base into a forward field for its gunships. Cross the runway, clear the drones off the apron, and take the hangar row before their Titan wakes up.',
  sky: {hdr: 'sunset', bg: 0.5, env: 0.6}, fog: [0x8a6c55, 0.0034], exposure: 0.78,
  sun: {color: 0xffb27a, power: 3.0, dir: [-70, 40, -25]}, hemi: [0xd6b48c, 0x3a2a1c, 0.85],
  weather: 'dust', headlight: 90,
  ground: {tex: 'sand_01', repeat: 80, color: 0xb3a596, rough: 0.95, metal: 0, size: 700, at: [0, -60]},
  tex: ['sand_01', 'asphalt_02', 'cracked_concrete_wall'],
  assets: ['warehouse', 'tanks', 'vtol', 'hind', 'mech_military', 'truck', 'apc', 'container', 'road_barrier', 'barrel', 'crate', 'drone'],
  bounds: {x0: -48, x1: 56, z0: -138, z1: 10},
  start: [4, 2, Math.PI], rally: [4, -70],
  waves: [
    {obj: ['Take the runway', 'Androids and drones guard the airstrip'], hint: 'Drones fly. Lift your aim, or lock them with rockets on right click or Q.',
      droids: [['cyborg', 0, -36], ['cyborg', 9, -38], ['biped', -4, -44], ['cyborg', 14, -46], ['biped', 6, -54]], drones: [[-2, -62], [14, -66]], strikers: [[4, -92, 0]]},
    {banner: ['WAVE 2', 'STRIKERS FROM THE HANGARS'], obj: ['Hold the apron', 'Strikers and gunship drones'],
      droids: [['biped', -10, -86], ['cyborg', 22, -76], ['cyborg', -4, -98], ['biped', 18, -102]], drones: [[-16, -110], [30, -112], [6, -120]], strikers: [[-12, -126, 0], [10, -130, 8], [32, -124, 16]]},
    {banner: ['TITAN INBOUND', 'IT WAS SLEEPING IN THE HANGAR'], obj: ['Bring down the Titan', 'Overheat its core, then take it or finish it'],
      titans: [[6, -128, 0]], strikers: [[-18, -124, 8], [32, -118, 20]], drones: [[-10, -118], [22, -122]]},
  ],
  win: {destroy: ['THE AIRFIELD IS OURS', 'You destroyed the Titan. The AI lost its forward airfield.'], hijack: 'You flew their Titan out of the hangar. The airfield is yours.'},
  build(c) {
    const {THREE, scene} = c;
    // runway: asphalt strip with a dashed centre line
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(26, 340), c.mat('asphalt_02', {repeat: [5, 64], color: 0x6c6862, rough: 0.6}));
    rw.rotation.x = -Math.PI / 2; rw.position.set(4, -0.205, -80); rw.receiveShadow = true; scene.add(rw);
    const dash = new THREE.MeshStandardMaterial({color: 0xd8d2c0, roughness: 0.7});
    for (let z = 30; z > -220; z -= 14) { const d = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 7), dash); d.rotation.x = -Math.PI / 2; d.position.set(4, -0.2, z); scene.add(d); }
    for (const x of [-8.5, 16.5]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 340), dash); e.rotation.x = -Math.PI / 2; e.position.set(x, -0.2, -80); scene.add(e); }
    // hangars: one long hangar walls the west side, another closes the north
    c.place('warehouse', 10, -40, -62);
    c.place('warehouse', 10, 8, -160, {rot: Math.PI / 2, solid: false});
    c.place('warehouse', 10, 64, -40, {solid: false});
    c.place('tanks', 14.4, 44, -96, {solid: 'parts'});
    c.place('vtol', 4.35, 27, -30, {rot: 0.35, solid: 'parts'});
    c.place('hind', 5.6, -16, -102, {rot: 2.4, solid: false}); c.circle(-16, -102, 4.5);
    c.place('mech_military', 12, -18, -12, {rot: 0.9, solid: false}); c.circle(-18, -12, 5.5); c.fire(-17, 2.5, -10, 0.9);
    for (const [x, z, r, f] of [[8, -48, 0.3, 0.8], [-6, -72, 1.8, 0], [22, -88, -0.6, 1.0], [36, -58, 1.2, 0], [-26, -122, 0.4, 0.7]]) { c.place('truck', 1.75, x, z, {rot: r}); if (f) c.fire(x, 0.8, z, f); }
    for (const [x, z, r, f] of [[-10, -30, 0.2, 0], [14, -112, 2.6, 1.1], [40, -16, -0.4, 0]]) { c.place('apc', 3.6, x, z, {rot: r}); if (f) c.fire(x, 1.4, z, f); }
    for (const [x, z, r, n] of [[30, -64, Math.PI / 2, 2], [33, -64, Math.PI / 2, 1], [-4, -122, 0, 2], [24, -124, 0.2, 1], [-30, -6, 0.1, 2]]) c.stack('container', 2.34, x, z, r, n);
    for (const [x, z, r] of [[-9, -20, 0], [-9, -24, 0.1], [17, -40, 0], [17, -44, -0.1], [-9, -80, 0], [17, -96, 0.2], [17, -100, 0.1]]) c.place('road_barrier', 1.0, x, z, {rot: r, y: -0.12, solid: false});
    for (const [x, z] of [[-12, -33], [-11.4, -33.6], [20, -60], [26, -86], [-28, -118]]) c.place('barrel', 0.95, x, z, {rot: x, y: -0.1, solid: false});
    for (const [x, z, r] of [[-7, -26, 0.3], [19, -57, 0.4], [3, -118, 1.1]]) c.place('crate', 0.32, x, z, {rot: r, y: -0.1, solid: false});
    c.fire(26, 0.6, -36, 0.9);
    // concrete blast walls give cover on the open apron, plus a control tower on the west edge
    const blast = c.mat('cracked_concrete_wall', {color: 0x9c958c, cell: 4});
    for (const [x0, x1, z0, z1, h] of [[-27, -25.6, -40, -32, 3], [36, 44, -29.4, -28, 3], [-26, -24.6, -92, -84, 3], [40, 48, -110.4, -109, 3], [24, 30, -50.4, -49, 2.6], [-22, -16, -60.4, -59, 2.6], [30, 31.4, -86, -78, 3]]) c.block(x0, x1, z0, z1, h, {mat: blast});
    c.block(-40, -32, -132, -124, 15);
    // an AI gunship circles the field
    c.gunship(0, -70, 75, 38);
  },
};

const dam = {
  id: 'dam', n: 3, name: 'Frozen Dam', sub: '06:10 · HYDRO PLANT SEVEN',
  brief: 'The dam feeds power to the AI data farms in the valley below. Fight up the frozen spillway road to the wall, break the garrison, and the grid goes dark.',
  sky: {hdr: 'snow', bg: 0.4, env: 0.55}, fog: [0x7d8894, 0.0072], exposure: 0.62,
  sun: {color: 0xe8f0ff, power: 1.9, dir: [40, 60, 30]}, hemi: [0xb8c4d2, 0x3c444e, 0.7],
  weather: 'snow', headlight: 140,
  ground: {tex: 'snow_02', repeat: 70, color: 0xb4bcc6, rough: 0.85, metal: 0, size: 700, at: [0, -60]},
  tex: ['snow_02', 'cracked_concrete_wall', 'rusty_metal_02'],
  assets: ['mech_snow', 'tanks', 'truck', 'apc', 'container', 'road_barrier', 'barrel', 'crate', 'drone'],
  bounds: {x0: -48, x1: 40, z0: -132, z1: 10},
  start: [0, 2, Math.PI], rally: [0, -66],
  waves: [
    {obj: ['Clear the spillway road', 'Androids dug in behind the bunkers'], hint: 'Bunkers stop bullets both ways. Flank them.',
      droids: [['cyborg', 6, -36], ['cyborg', -10, -44], ['biped', 12, -50], ['cyborg', -2, -58], ['biped', 20, -62]], drones: [[0, -70]], strikers: [[-6, -92, 0]]},
    {banner: ['WAVE 2', 'GARRISON ON THE MOVE'], obj: ['Break the garrison', 'Strikers are coming down from the wall'],
      droids: [['cyborg', -20, -88], ['biped', 18, -84], ['cyborg', 8, -104], ['biped', -8, -112]], drones: [[-24, -100], [24, -108]], strikers: [[-20, -124, 0], [14, -126, 8], [28, -118, 16]]},
    {banner: ['TITAN INBOUND', 'IT GUARDS THE TURBINES'], obj: ['Bring down the Titan', 'Overheat its core, then take it or finish it'],
      titans: [[-2, -124, 0]], strikers: [[-26, -120, 8], [24, -122, 20]], drones: [[-14, -116], [16, -118], [0, -110]]},
  ],
  win: {destroy: ['THE GRID GOES DARK', 'You destroyed the Titan. The dam no longer powers the AI.'], hijack: 'Their Titan guards the dam for us now. The grid goes dark.'},
  build(c) {
    const {THREE, scene} = c;
    const wall = c.mat('cracked_concrete_wall', {color: 0x9ea6ae, rough: 0.9, cell: 8});
    // the dam: a huge concrete wall to the north with buttresses and a lit crest
    c.block(-140, 140, -175, -140, 46, {mat: wall, solid: false});
    for (const x of [-60, -24, 12, 48]) c.block(x - 5, x + 5, -140, -133, 34, {mat: wall});
    for (let x = -130; x <= 130; x += 10) { const l = c.glow(0xfff2d8, 1.2); l.position.set(x, 46.6, -139.5); }
    // snow banks and retaining walls close the valley
    for (const [x0, x1, z0, z1, h] of [[-90, -48, -140, -80, 22], [-86, -50, -80, -20, 16], [-82, -48, -20, 30, 12], [40, 80, -140, -90, 20], [40, 84, -90, -30, 15], [40, 78, -30, 30, 11]])
      c.block(x0, x1, z0, z1, h, {mat: wall, solid: false, snowTop: true});
    // bunkers on the approach road
    for (const [x, z] of [[8, -40], [-10, -56], [20, -68], [4, -84], [-18, -100], [26, -104], [10, -116]]) c.block(x - 3, x + 3, z - 2, z + 2, 3.2, {mat: wall, snowTop: true});
    // a pipeline runs down the east side
    const pipeMat = c.mat('rusty_metal_02', {color: 0x8a7a6a, rough: 0.6, metal: 0.6});
    for (const y of [1.6, 3.9]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 150, 20), pipeMat); p.rotation.x = Math.PI / 2; p.position.set(36.5, y, -60); p.castShadow = p.receiveShadow = true; scene.add(p); }
    for (let z = -130; z <= 10; z += 12) c.block(35, 38, z - 0.5, z + 0.5, 0.6, {mat: pipeMat, solid: false});
    c.box(35, 41, -140, 15, 5);
    c.place('tanks', 14.4, -36, -74, {rot: Math.PI / 2, solid: 'parts'});
    c.cockpitMech('mech_snow', -14, -14, 0.8, {keep: 0.6, dark: 1.0, tint: [1, 1, 1]}, 0xdfe8ff, [-6, 7.5, -8]);
    for (const [x, z, r] of [[-30, -20, 0.4], [26, -30, 2.0], [-28, -110, -0.4]]) c.place('truck', 1.75, x, z, {rot: r});
    for (const [x, z, r, f] of [[12, -18, 1.4, 0.8], [-24, -64, 0.2, 0]]) { c.place('apc', 3.6, x, z, {rot: r}); if (f) c.fire(x, 1.4, z, f); }
    for (const [x, z, r, n] of [[-30, -40, 0.1, 2], [28, -88, Math.PI / 2, 2], [-36, -124, 0.3, 1]]) c.stack('container', 2.34, x, z, r, n);
    for (const [x, z, r] of [[-6, -26, 0], [-3, -26.4, 0.1], [14, -48, 0.2], [-14, -78, -0.3], [16, -94, 0]]) c.place('road_barrier', 1.0, x, z, {rot: r, y: -0.12, solid: false});
    for (const [x, z] of [[-20, -30], [-19.4, -30.6], [30, -40]]) c.place('barrel', 0.95, x, z, {rot: x, y: -0.1, solid: false});
    c.fire(-28, 0.6, -110, 0.8);
  },
};

const port = {
  id: 'port', n: 4, name: 'Container Port', sub: '11:30 · NORTH TERMINAL',
  brief: 'Every machine the AI builds ships out of this terminal. Fight through the container stacks, keep away from the open quay, and stop the last Titan before it is loaded.',
  sky: {hdr: 'overcast', bg: 0.38, env: 0.7}, fog: [0x6c7783, 0.006], exposure: 0.8,
  sun: {color: 0xdde4ee, power: 1.7, dir: [30, 70, 40]}, hemi: [0xb8c4d0, 0x2a2e34, 0.9],
  weather: 'rain', headlight: 150,
  ground: {tex: 'concrete_floor_worn_001', repeat: 90, color: 0x8e8e8e, rough: 0.7, metal: 0.05, size: 700, at: [0, -60]},
  tex: ['concrete_floor_worn_001', 'rusty_metal_02'],
  assets: ['port', 'container', 'truck', 'apc', 'road_barrier', 'barrel', 'crate', 'drone'],
  bounds: {x0: -48, x1: 50, z0: -136, z1: 10},
  start: [0, 2, Math.PI], rally: [0, -70],
  waves: [
    {obj: ['Enter the terminal', 'Androids among the first stacks'], hint: 'Stacks block shots and your camera. Use the lanes between them.',
      droids: [['cyborg', -6, -30], ['cyborg', 8, -34], ['biped', 18, -40], ['cyborg', -15, -43], ['biped', -10, -45]], drones: [[10, -56]], strikers: [[0, -88, 0]]},
    {banner: ['WAVE 2', 'STRIKERS IN THE STACKS'], obj: ['Clear the stacks', 'They know the lanes better than you'],
      droids: [['cyborg', -33, -88], ['biped', 30, -80], ['cyborg', 14, -100], ['biped', -14, -104]], drones: [[-20, -96], [26, -104]], strikers: [[-20, -124, 0], [8, -128, 8], [34, -122, 16]]},
    {banner: ['TITAN INBOUND', 'STOP IT BEFORE IT SHIPS'], obj: ['Bring down the Titan', 'Overheat its core, then take it or finish it'],
      titans: [[4, -126, 0]], strikers: [[-24, -120, 8], [30, -116, 20]], drones: [[-12, -114], [20, -118]]},
  ],
  win: {destroy: ['THE TERMINAL IS CLOSED', 'You destroyed the Titan. Nothing ships from this port again.'], hijack: 'Their Titan never made the ship. It is ours now.'},
  build(c) {
    const {THREE, scene} = c;
    // the terminal: container stacks on a concrete apron (the model's own plate is replaced by our ground)
    const port = c.place('port', 0, 0, -72, {scale: 31.7, solid: 'parts', minH: 1.2, hide: m => (m.material.name || '').toLowerCase() === 'concrete'});
    // more stacks to give the south approach some cover
    for (const [x, z, r, n] of [[-22, -16, 0, 2], [24, -14, Math.PI / 2, 1], [-32, -126, 0, 3], [36, -128, 0.1, 2], [44, -64, Math.PI / 2, 3], [44, -100, Math.PI / 2, 2], [-42, -60, Math.PI / 2, 3], [-42, -96, Math.PI / 2, 2]]) c.stack('container', 2.34, x, z, r, n);
    // quay edge and the harbour to the east
    const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 600), new THREE.MeshStandardMaterial({color: 0x1a2630, roughness: 0.12, metalness: 0.4}));
    water.rotation.x = -Math.PI / 2; water.position.set(258, -1.6, -60); scene.add(water);
    c.block(57.5, 58.5, -300, 160, 0.25, {mat: c.mat('concrete_floor_worn_001', {color: 0xb8b0a0}), solid: false, y0: -1.6});
    // two gantry cranes over the quay
    const red = c.mat('rusty_metal_02', {color: 0xa8412c, rough: 0.6, metal: 0.5});
    for (const zc of [-40, -104]) {
      for (const [x, dz] of [[47, -7], [47, 7], [66, -7], [66, 7]]) c.block(x - 0.9, x + 0.9, zc + dz - 0.9, zc + dz + 0.9, 32, {mat: red, solid: x < 50});
      c.block(30, 110, zc - 8, zc - 6, 34, {mat: red, solid: false, y0: 31}); c.block(30, 110, zc + 6, zc + 8, 34, {mat: red, solid: false, y0: 31});
      c.block(45, 68, zc - 8, zc + 8, 32, {mat: red, solid: false, y0: 30.4});
      const l = c.glow(0xff3020, 1.6); l.position.set(110, 34.6, zc);
    }
    for (const [x, z, r] of [[-12, -6, 0.3], [30, -36, 1.6], [-30, -112, 0.2]]) c.place('truck', 1.75, x, z, {rot: r});
    for (const [x, z, r, f] of [[14, -22, 2.0, 0.8], [-34, -20, 0.6, 0]]) { c.place('apc', 3.6, x, z, {rot: r}); if (f) c.fire(x, 1.4, z, f); }
    for (const [x, z, r] of [[-4, -20, 0], [-1, -20.3, 0.1], [10, -112, 0.2], [13, -112, 0.1]]) c.place('road_barrier', 1.0, x, z, {rot: r, y: -0.12, solid: false});
    for (const [x, z] of [[18, -28], [18.6, -28.6], [-24, -30]]) c.place('barrel', 0.95, x, z, {rot: x, y: -0.1, solid: false});
    c.fire(-30, 0.6, -112, 0.9);
  },
};

const valley = {
  id: 'valley', n: 5, name: 'Server Valley', sub: '05:20 · AI DATA FARM',
  brief: 'The AI thinks in this valley. Rows of server racks run its war, and the fog never lifts. Walk the lanes, break the guard, and burn its memory down to the floor.',
  sky: {hdr: 'misty', bg: 0.3, env: 0.55}, fog: [0x4a5664, 0.0095], exposure: 0.85,
  sun: {color: 0xd6e4ff, power: 1.4, dir: [-30, 60, 40]}, hemi: [0xa8b8c8, 0x1c2024, 0.75],
  weather: 'motes', headlight: 200,
  ground: {tex: 'concrete_floor_worn_001', repeat: 80, color: 0x5c6268, rough: 0.65, metal: 0.1, size: 700, at: [0, -60]},
  tex: ['concrete_floor_worn_001', 'cracked_concrete_wall', 'metal_plate'],
  assets: ['hangar', 'tanks', 'truck', 'apc', 'road_barrier', 'barrel', 'drone'],
  bounds: {x0: -46, x1: 46, z0: -136, z1: 10},
  start: [0, 2, Math.PI], rally: [0, -66],
  waves: [
    {obj: ['Walk the lanes', 'Guard androids between the racks'], hint: 'Racks block shots. Watch the side lanes.',
      droids: [['cyborg', -6, -28], ['cyborg', 7, -32], ['biped', -27.5, -52], ['cyborg', 27.5, -52], ['biped', 0, -56]], drones: [[-10, -62], [12, -66]], strikers: [[0, -96, 0]]},
    {banner: ['WAVE 2', 'THE FARM WAKES UP'], obj: ['Break the guard', 'Drones swarm from the cores'],
      droids: [['cyborg', -27.5, -92], ['biped', 27.5, -92], ['cyborg', -8, -106], ['biped', 10, -112]], drones: [[-24, -100], [24, -104], [-4, -114], [12, -118]], strikers: [[-27, -119, 0], [27, -119, 8], [0, -130, 16]]},
    {banner: ['TITAN INBOUND', 'THE FARM SENDS ITS KEEPER'], obj: ['Bring down the Titan', 'Overheat its core, then take it or finish it'],
      titans: [[0, -126, 0]], strikers: [[-26, -118, 8], [26, -120, 20]], drones: [[-16, -112], [16, -114], [0, -104]]},
  ],
  win: {destroy: ['THE VALLEY GOES QUIET', 'You destroyed the Titan. The AI lost its data farm.'], hijack: 'Their keeper walks for us now. The data farm is ours.'},
  build(c) {
    const {THREE, scene} = c;
    const rock = c.mat('cracked_concrete_wall', {color: 0x4a5058, rough: 0.95, cell: 10});
    // valley walls
    for (const [x0, x1, z0, z1, h] of [[-90, -52, -170, -100, 34], [-84, -50, -100, -40, 26], [-88, -52, -40, 30, 20], [50, 90, -170, -110, 30], [52, 86, -110, -50, 24], [50, 88, -50, 30, 18], [-60, 60, -190, -160, 40]])
      c.block(x0, x1, z0, z1, h, {mat: rock, solid: false});
    // server racks in rows, glowing cyan
    const rack = c.rackMat(0x40d8ff);
    for (const x of [-34, -21, 21, 34]) for (const z of [-22, -42, -62, -82, -102, -122]) c.block(x - 1.8, x + 1.8, z - 7, z + 7, 8.5, {mat: rack, roof: c.mat('metal_plate', {color: 0x22262a, metal: 0.7, rough: 0.5})});
    c.block(-6, 6, -74, -70, 6, {mat: rack}); c.block(-6, 6, -40, -36, 5, {mat: rack});
    // data cores at the head of the valley
    for (const x of [-22, 22]) { c.place('hangar', 14, x, -140, {solid: 'parts', rot: x > 0 ? -0.4 : 0.4, emissive: 0x2aa8ff}); c.beam(x, -140, 0x40c8ff, 3); }
    c.place('tanks', 14.4, 0, -168, {solid: false});
    for (const [x, z, r] of [[-10, -12, 0.5], [12, -90, 1.8]]) c.place('truck', 1.75, x, z, {rot: r});
    c.place('apc', 3.6, 10, -20, {rot: 2.2}); c.fire(10, 1.4, -20, 0.7);
    for (const [x, z, r] of [[-3, -48, 0], [0, -48.3, 0.1], [3, -48, -0.1], [-12, -96, 0.3], [12, -100, -0.2]]) c.place('road_barrier', 1.0, x, z, {rot: r, y: -0.12, solid: false});
  },
};

const core = {
  id: 'core', n: 6, name: 'The Core', sub: '00:00 · AI CORE CHAMBER',
  brief: 'This is where the AI lives. Two Titans guard the Core, and its shield holds while they stand. Bring them down, then burn the Core itself.',
  sky: {hdr: 'night', bg: 0.06, env: 0.35, color: 0x050206}, fog: [0x1a0b10, 0.0105], exposure: 1.0,
  sun: {color: 0x9aa8d8, power: 1.1, dir: [-30, 70, 40]}, hemi: [0x502a34, 0x060304, 0.65],
  weather: 'embers', headlight: 110,
  ground: {tex: 'metal_plate', repeat: 90, color: 0x44474d, rough: 0.72, metal: 0.35, size: 700, at: [0, -60]},
  tex: ['metal_plate', 'cracked_concrete_wall'],
  assets: ['hangar', 'drone', 'barrel'],
  bounds: {x0: -50, x1: 50, z0: -134, z1: 10},
  start: [0, 2, Math.PI], rally: [0, -50],
  core: {x: 0, z: -112, hp: 9000},
  waves: [
    {obj: ['Reach the Core', 'Its guard is waiting'], hint: 'The Core is shielded while its Titans stand.',
      droids: [['cyborg', -8, -30], ['cyborg', 8, -32], ['biped', -20, -44], ['biped', 20, -46]], drones: [[-12, -54], [12, -56], [0, -62]], strikers: [[0, -84, 0]]},
    {banner: ['WAVE 2', 'THE CORE DEFENDS ITSELF'], obj: ['Break the guard', 'Strikers and drones'],
      droids: [['cyborg', -30, -70], ['cyborg', 30, -72]], drones: [[-24, -80], [24, -82], [-10, -90], [10, -92]], strikers: [[-30, -100, 0], [30, -100, 8], [0, -86, 16]]},
    {banner: ['TWO TITANS', 'THE LAST GUARD'], obj: ['Bring down both Titans', 'Overheat them, then take or finish them'],
      titans: [[-24, -96, 0], [24, -98, 10]], strikers: [[-36, -80, 22]], drones: [[-14, -84], [14, -86]]},
  ],
  win: {core: 'The Core is gone. The war machines stand still across the world.'},
  build(c) {
    const {THREE, scene} = c;
    const pylon = c.rackMat(0xff3a2a);
    // the chamber: a ring of red-lit pylons
    for (let i = 0; i < 22; i++) { const a = -Math.PI * 0.95 + i / 21 * Math.PI * 1.9, r = 66, x = Math.sin(a) * r, z = -66 - Math.cos(a) * r * 1.15; c.block(x - 3, x + 3, z - 3, z + 3, 14 + (i % 3) * 6, {mat: pylon, solid: false}); }
    for (const [x, z] of [[-26, -30], [26, -30], [-34, -60], [34, -60], [-16, -70], [16, -70], [-30, -88], [30, -88]]) c.block(x - 2, x + 2, z - 2, z + 2, 9, {mat: pylon});
    // the Core
    const m = c.place('hangar', 26, 0, -112, {solid: false, emissive: 0xff2a14, emissivePower: 1.4});
    m.traverse(o => { if (o.isMesh) o.material.color.setRGB(0.24, 0.21, 0.23); }); // dark machine, red glow
    c.core = m; c.beam(0, -112, 0xff3020, 5);
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(25, 25, 34, 48, 1, true), new THREE.MeshBasicMaterial({color: 0xff2a1a, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide}));
    sh.position.set(0, 16, -112); scene.add(sh); c.shield = sh;
    for (const [x, z] of [[-8, -22], [9, -40], [-12, -58]]) c.place('barrel', 0.95, x, z, {rot: x, y: -0.1, solid: false});
  },
};

export const LEVELS = [city, desert, dam, port, valley, core];
export const levelById = id => LEVELS.find(l => l.id === id) || city;
