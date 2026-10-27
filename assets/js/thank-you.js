// Thank-you page countdown (moved out of thank-you.html for a strict CSP).
(function () {
      var seconds = 15, el = document.getElementById('countdown');
      var timer = setInterval(function () {
        seconds--;
        if (el) el.textContent = seconds;
        if (seconds <= 0) { clearInterval(timer); window.location.href = '/'; }
      }, 1000);
      document.getElementById('stayBtn').addEventListener('click', function () {
        clearInterval(timer);
        document.getElementById('countdownWrap').textContent = 'You can stay on this page.';
      });
    })();
