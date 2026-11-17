async function refreshStatus() {
    try {
        const response = await fetch('/api/status');
        const data: { sessions: number; participants: number } = await response.json();
        const sessionsEl = document.getElementById('sessions');
        const participantsEl = document.getElementById('participants');
        if (sessionsEl) sessionsEl.textContent = 'vibecheck attivi: ' + data.sessions;
        if (participantsEl) participantsEl.textContent = 'partecipanti: ' + data.participants;
    } catch {
        // server not reachable yet, retry on next tick
    }
}

refreshStatus();
setInterval(refreshStatus, 1000);
