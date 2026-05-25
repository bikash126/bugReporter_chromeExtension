const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode');

const JIRA_DOMAIN = 'ebp.atlassian.net';
const JIRA_EMAIL = 'bikash@ebpearls.com.au';
// const JIRA_TOKEN = 'YOUR_JIRA_API_TOKEN_HERE'; // <-- Do NOT hardcode secrets. Use environment variables or secure storage.
const JIRA_TOKEN = window.JIRA_TOKEN || '';
const JIRA_PROJECT = 'EBPLANNER';

// UI Elements
const canvas = document.getElementById('markupCanvas');
const videoPreview = document.getElementById('videoPreview');
const controls = document.getElementById('controls');
const markupTools = document.getElementById('markupTools');
const drawToolBtn = document.getElementById('drawToolBtn');
const textToolBtn = document.getElementById('textToolBtn');
const rectToolBtn = document.getElementById('rectToolBtn');
const circleToolBtn = document.getElementById('circleToolBtn');
const deleteToolBtn = document.getElementById('deleteToolBtn');
const mediaStage = document.getElementById('mediaStage');
const workspace = document.querySelector('.workspace');
const statusDiv = document.getElementById('status');

// State
let finalBlob = null;
let blobFilename = "attachment";
let activeTool = 'draw';
let mediaRecorder;
let recordedChunks = [];
let markupCanvas = null;
let imageSize = null;
let shapeInProgress = null;
let shapeStartPoint = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  if (mode === 'image') {
    setupImageMode();
  } else if (mode === 'video') {
    setupVideoMode();
  }
});

// --- IMAGE & MARKUP LOGIC ---
function setupImageMode() {
  canvas.style.display = 'block';
  markupTools.style.display = 'flex';

  markupCanvas = new fabric.Canvas('markupCanvas', {
    isDrawingMode: true,
    preserveObjectStacking: true,
    selection: true
  });
  markupCanvas.freeDrawingBrush.color = 'red';
  markupCanvas.freeDrawingBrush.width = 5;

  const setActiveTool = (tool) => {
    activeTool = tool;
    drawToolBtn.classList.toggle('active', tool === 'draw');
    textToolBtn.classList.toggle('active', tool === 'text');
    rectToolBtn.classList.toggle('active', tool === 'rect');
    circleToolBtn.classList.toggle('active', tool === 'circle');
    canvas.style.cursor = tool === 'text' ? 'text' : tool === 'draw' ? 'crosshair' : 'default';
    markupCanvas.isDrawingMode = tool === 'draw';
    if (tool !== 'draw') {
      markupCanvas.discardActiveObject();
      markupCanvas.renderAll();
    }
  };

  drawToolBtn.addEventListener('click', () => setActiveTool('draw'));
  textToolBtn.addEventListener('click', () => setActiveTool('text'));
  rectToolBtn.addEventListener('click', () => setActiveTool('rect'));
  circleToolBtn.addEventListener('click', () => setActiveTool('circle'));
  deleteToolBtn.addEventListener('click', () => {
    removeSelectedMarkup();
  });

  chrome.storage.local.get(['capturedImage'], (data) => {
    if (data.capturedImage) {
      fabric.Image.fromURL(data.capturedImage, (img) => {
        imageSize = { width: img.width, height: img.height };
        markupCanvas.setDimensions({ width: img.width, height: img.height });
        markupCanvas.setBackgroundImage(img, markupCanvas.renderAll.bind(markupCanvas), {
          originX: 'left',
          originY: 'top'
        });
        syncCanvasDisplaySize();
      }, { crossOrigin: 'anonymous' });
    }
  });

  window.addEventListener('resize', syncCanvasDisplaySize);

  markupCanvas.on('mouse:down', (event) => {
    if (activeTool === 'text') {
      if (event.target) return;

      const pointer = markupCanvas.getPointer(event.e);
      const textObject = new fabric.IText('Type here', {
        left: pointer.x,
        top: pointer.y,
        fill: '#172B4D',
        fontSize: 28,
        fontFamily: 'Arial',
        editable: true,
        backgroundColor: '',
        borderColor: '#0052CC',
        cornerColor: '#0052CC',
        transparentCorners: false
      });

      markupCanvas.add(textObject);
      markupCanvas.setActiveObject(textObject);
      textObject.enterEditing();
      if (textObject.hiddenTextarea) {
        textObject.hiddenTextarea.focus();
        textObject.selectAll();
      }

      statusDiv.innerText = 'Text added. Drag to move it or type to edit.';
      statusDiv.style.color = '#0052CC';
      return;
    }

    if ((activeTool === 'rect' || activeTool === 'circle') && !event.target) {
      beginShape(event.e);
    }
  });

  markupCanvas.on('mouse:move', (event) => {
    if (!shapeInProgress || !shapeStartPoint) return;
    updateShape(event.e);
  });

  markupCanvas.on('mouse:up', () => {
    finishShape();
  });

  markupCanvas.on('path:created', (event) => {
    const path = event.path;
    if (!path) return;

    path.set({ selectable: true, evented: true });
    setActiveTool('select');
    markupCanvas.setActiveObject(path);
    markupCanvas.requestRenderAll();
    statusDiv.innerText = 'Drawing added. Click any markup to select it, or choose Draw to add another.';
    statusDiv.style.color = '#0052CC';
  });

  window.addEventListener('keydown', handleMarkupDelete);
}

function beginShape(nativeEvent) {
  const pointer = markupCanvas.getPointer(nativeEvent);
  shapeStartPoint = pointer;

  if (activeTool === 'rect') {
    shapeInProgress = new fabric.Rect({
      left: pointer.x,
      top: pointer.y,
      width: 1,
      height: 1,
      fill: 'transparent',
      stroke: 'red',
      strokeWidth: 4,
      selectable: false,
      evented: false,
      objectCaching: false
    });
  } else if (activeTool === 'circle') {
    shapeInProgress = new fabric.Ellipse({
      left: pointer.x,
      top: pointer.y,
      rx: 1,
      ry: 1,
      originX: 'center',
      originY: 'center',
      fill: 'transparent',
      stroke: 'red',
      strokeWidth: 4,
      selectable: false,
      evented: false,
      objectCaching: false
    });
  }

  if (!shapeInProgress) return;
  markupCanvas.add(shapeInProgress);
  statusDiv.innerText = `${activeTool === 'rect' ? 'Rectangle' : 'Circle'} markup started.`;
  statusDiv.style.color = '#0052CC';
}

function updateShape(nativeEvent) {
  const pointer = markupCanvas.getPointer(nativeEvent);

  if (activeTool === 'rect' && shapeInProgress.type === 'rect') {
    const left = Math.min(shapeStartPoint.x, pointer.x);
    const top = Math.min(shapeStartPoint.y, pointer.y);
    const width = Math.abs(pointer.x - shapeStartPoint.x);
    const height = Math.abs(pointer.y - shapeStartPoint.y);

    shapeInProgress.set({ left, top, width, height });
  }

  if (activeTool === 'circle' && shapeInProgress.type === 'ellipse') {
    const centerX = (shapeStartPoint.x + pointer.x) / 2;
    const centerY = (shapeStartPoint.y + pointer.y) / 2;
    const radiusX = Math.abs(pointer.x - shapeStartPoint.x) / 2;
    const radiusY = Math.abs(pointer.y - shapeStartPoint.y) / 2;

    shapeInProgress.set({ left: centerX, top: centerY, rx: radiusX, ry: radiusY });
  }

  markupCanvas.requestRenderAll();
}

function finishShape() {
  if (!shapeInProgress) return;

  const isTinyRect = shapeInProgress.type === 'rect' && (shapeInProgress.width < 4 || shapeInProgress.height < 4);
  const isTinyCircle = shapeInProgress.type === 'ellipse' && (shapeInProgress.rx < 2 || shapeInProgress.ry < 2);

  if (isTinyRect || isTinyCircle) {
    markupCanvas.remove(shapeInProgress);
  } else {
    shapeInProgress.set({ selectable: true, evented: true });
    markupCanvas.setActiveObject(shapeInProgress);
  }

  shapeInProgress = null;
  shapeStartPoint = null;
  markupCanvas.requestRenderAll();
}

function handleMarkupDelete(event) {
  if (!markupCanvas) return;
  if (event.key !== 'Delete' && event.key !== 'Backspace') return;

  const activeObject = markupCanvas.getActiveObject();
  if (!activeObject) return;

  if (activeObject.isEditing || event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
    return;
  }

  event.preventDefault();
  removeSelectedMarkup();
}

function removeSelectedMarkup() {
  if (!markupCanvas) return;

  const activeObject = markupCanvas.getActiveObject();
  if (!activeObject) {
    statusDiv.innerText = 'Select a markup to delete.';
    statusDiv.style.color = 'red';
    return;
  }

  if (activeObject.type === 'activeSelection') {
    activeObject.getObjects().forEach((object) => markupCanvas.remove(object));
  } else {
    markupCanvas.remove(activeObject);
  }

  markupCanvas.discardActiveObject();
  markupCanvas.requestRenderAll();
  statusDiv.innerText = 'Markup deleted.';
  statusDiv.style.color = '#0052CC';
}

function syncCanvasDisplaySize() {
  if (!markupCanvas || !imageSize) return;

  const stageStyles = window.getComputedStyle(mediaStage);
  const horizontalPadding = parseFloat(stageStyles.paddingLeft) + parseFloat(stageStyles.paddingRight);
  const verticalPadding = parseFloat(stageStyles.paddingTop) + parseFloat(stageStyles.paddingBottom);
  const stageWidth = Math.max(mediaStage.clientWidth - horizontalPadding, 1);
  const stageHeight = Math.max(mediaStage.clientHeight - verticalPadding, 1);
  const scale = Math.min(stageWidth / imageSize.width, stageHeight / imageSize.height, 1);
  const offsetX = (stageWidth - (imageSize.width * scale)) / 2;
  const offsetY = (stageHeight - (imageSize.height * scale)) / 2;

  markupCanvas.setDimensions({ width: stageWidth, height: stageHeight });
  markupCanvas.setViewportTransform([scale, 0, 0, scale, offsetX, offsetY]);

  markupCanvas.calcOffset();
  markupCanvas.renderAll();
}

async function buildImageBlob() {
  const originalDimensions = {
    width: markupCanvas.getWidth(),
    height: markupCanvas.getHeight()
  };
  const originalTransform = markupCanvas.viewportTransform.slice();

  markupCanvas.discardActiveObject();
  markupCanvas.setDimensions({ width: imageSize.width, height: imageSize.height });
  markupCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  markupCanvas.renderAll();

  const exportBlob = await new Promise((resolve) => markupCanvas.lowerCanvasEl.toBlob(resolve, 'image/png'));

  markupCanvas.setDimensions(originalDimensions);
  markupCanvas.setViewportTransform(originalTransform);
  markupCanvas.calcOffset();
  markupCanvas.renderAll();

  return exportBlob;
}

// --- VIDEO RECORDING LOGIC ---
function setupVideoMode() {
  controls.style.display = 'block';
  videoPreview.style.display = 'block';
  const startBtn = document.getElementById('startRecordBtn');
  const stopBtn = document.getElementById('stopRecordBtn');

  startBtn.addEventListener('click', async () => {
    try {
      // Prompt user to select screen/window
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      videoPreview.srcObject = stream;
      videoPreview.play();

      mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      recordedChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        finalBlob = new Blob(recordedChunks, { type: 'video/webm' });
        blobFilename = "screen-recording.webm";
        videoPreview.srcObject = null;
        videoPreview.src = URL.createObjectURL(finalBlob);
        videoPreview.controls = true;
        
        // Stop all tracks to turn off recording indicator
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      startBtn.style.display = 'none';
      stopBtn.style.display = 'inline-block';
    } catch (err) {
      console.error("Error starting recording:", err);
      alert("Could not start recording. Did you grant permission?");
    }
  });

  stopBtn.addEventListener('click', () => {
    mediaRecorder.stop();
    stopBtn.style.display = 'none';
  });
}

// --- JIRA SUBMISSION LOGIC ---
document.getElementById('submitBtn').addEventListener('click', async () => {
  const domain = JIRA_DOMAIN;
  const email = JIRA_EMAIL;
  const token = JIRA_TOKEN;
  const project = JIRA_PROJECT;
  const summary = document.getElementById('bugSummary').value;
  const description = document.getElementById('bugDescription').value;

  if (!domain || !email || !token || !project || !summary) {
    statusDiv.innerText = "Error: Jira constants and Bug Title are required.";
    statusDiv.style.color = "red";
    return;
  }

  statusDiv.innerText = "1. Creating Jira Issue...";
  statusDiv.style.color = "#0052CC";

  const authHeader = 'Basic ' + btoa(`${email}:${token}`);
  const baseUrl = `https://${domain}/rest/api/3`;

  try {
    // 1. Create Issue
    const issuePayload = {
      fields: {
        project: { key: project },
        summary: summary,
        description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ text: description, type: "text" }] }] },
        issuetype: { name: "Bug" } 
      }
    };

    const createRes = await fetch(`${baseUrl}/issue`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(issuePayload)
    });

    if (!createRes.ok) throw new Error("Failed to create ticket");
    const issueKey = (await createRes.json()).key;

    statusDiv.innerText = `2. Uploading Attachment to ${issueKey}...`;

    // 2. Prepare Final Blob (If Image Mode, pull from Canvas)
    if (mode === 'image') {
      finalBlob = await buildImageBlob();
      blobFilename = "screenshot-markup.png";
    }

    if (!finalBlob) throw new Error("No image or video captured!");

    // 3. Upload Attachment
    const formData = new FormData();
    formData.append("file", finalBlob, blobFilename);

    const attachRes = await fetch(`${baseUrl}/issue/${issueKey}/attachments`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'X-Atlassian-Token': 'no-check' 
      },
      body: formData
    });

    if (!attachRes.ok) throw new Error("Failed to attach media");

    const issueUrl = `https://${domain}/browse/${issueKey}`;
    statusDiv.innerHTML = `✅ Success! Ticket <a href="${issueUrl}" target="_blank" rel="noopener noreferrer">${issueKey}</a> created.`;
    statusDiv.style.color = "green";

  } catch (error) {
    console.error(error);
    statusDiv.innerText = `Error: ${error.message}`;
    statusDiv.style.color = "red";
  }
});