fetch("http://localhost:3000/api/upload/start", { method: "POST" }).then(res => res.text()).then(console.log);
