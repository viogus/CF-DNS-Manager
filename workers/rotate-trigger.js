export default {
  async scheduled(event, env, ctx) {
    const url = env.ROTATION_URL.replace(/\/+$/, '') + '/api/rotations/run';
    await fetch(url, {
      method: 'POST',
      headers: { 'X-Rotation-Key': env.ROTATION_API_KEY }
    });
  }
}
