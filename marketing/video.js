// Page-side helpers the recorder (video.mjs) calls.
const stage = document.getElementById('stage');
const say = document.getElementById('say');
const shake = () => {
  stage.classList.remove('shake');
  void stage.offsetWidth;
  stage.classList.add('shake');
};
window.V = {
  load: (url) => {
    document.getElementById('game').src = url;
  },
  open: () => document.getElementById('open').classList.add('out'),
  /** Two big lines beside the game, replacing whatever was there. */
  say: (first, second, hit) => {
    say.textContent = '';
    const b = document.createElement('b');
    b.textContent = first;
    say.append(b, second);
    say.classList.remove('in');
    void say.offsetWidth;
    say.classList.add('in');
    if (hit) setTimeout(shake, 160);
  },
  close: () => document.getElementById('close').classList.add('in'),
};
