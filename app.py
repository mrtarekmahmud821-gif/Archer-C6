from fastapi import FastAPI, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from controller import BandwidthController
import uvicorn

app = FastAPI(title="Pi Bandwidth Controller")
templates = Jinja2Templates(directory="templates")
bc = BandwidthController()

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    devices = bc.get_connected_devices()
    return templates.TemplateResponse("index.html", {
        "request": request,
        "devices": devices
    })

@app.post("/limit")
async def set_limit(ip: str = Form(...), speed: int = Form(...)):
    bc.set_device_limit(ip, speed)
    return RedirectResponse(url="/", status_code=303)

@app.post("/block")
async def block(ip: str = Form(...)):
    bc.block_device(ip)
    return RedirectResponse(url="/", status_code=303)

@app.post("/unblock")
async def unblock(ip: str = Form(...)):
    bc.unblock_device(ip)
    return RedirectResponse(url="/", status_code=303)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
