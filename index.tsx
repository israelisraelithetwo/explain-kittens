/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, Modality} from '@google/genai';
import {marked} from 'marked';
import JSZip from 'jszip'; // Import JSZip

const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

const chat = ai.chats.create({
  model: 'gemini-2.0-flash-preview-image-generation',
  config: {
    responseModalities: [Modality.TEXT, Modality.IMAGE],
  },
  history: [],
});

const userInput = document.querySelector('#input') as HTMLTextAreaElement;
const modelOutput = document.querySelector('#output') as HTMLDivElement;
const slideshow = document.querySelector('#slideshow') as HTMLDivElement;
const error = document.querySelector('#error') as HTMLDivElement;
const downloadZipButton = document.querySelector('#downloadZipButton') as HTMLButtonElement; // Get the button

// --- START OF MODIFIED SECTION ---
const additionalInstructions = `
Use a fun story about lots of tiny cats as a metaphor.
The story must describe a sequence of actions or a clear progression of an event, step-by-step.
You should aim to generate between 20 and 40 images in total for this sequence.

For each step in the story:
1. Write a short, conversational, casual, and engaging sentence describing the action.
2. Generate one cute, minimal illustration (black ink on a white background) for that specific sentence/action.

Crucially, all illustrations in the sequence must depict the *same cat(s)* consistently across all images, showing them performing the described actions in stages. This will help create a sense of "flip-book" style animation or motion when viewed in order.
Imagine you are creating frames for a very short, simple animation.

No commentary about the process, just begin your explanation with the first sentence and its corresponding image.
Continue generating sentence-image pairs until the entire sequence of actions is illustrated and you have produced approximately 20-40 images.`;

// Array to store slide data for export
interface SlideData {
  text: string;
  imageDataUrl: string;
  imageName: string;
}
let slidesDataForExport: SlideData[] = [];
// --- END OF MODIFIED SECTION ---

async function addSlide(text: string, image: HTMLImageElement, slideIndex: number) {
  const slide = document.createElement('div');
  slide.className = 'slide';
  const caption = document.createElement('div') as HTMLDivElement;
  caption.innerHTML = await marked.parse(text);
  slide.append(image.cloneNode(true) as HTMLImageElement); // Clone image for display
  slide.append(caption);
  slideshow.append(slide);

  // Store data for export
  slidesDataForExport.push({
    text: text,
    imageDataUrl: image.src, // This is the base64 data URI
    imageName: `slide_${String(slideIndex + 1).padStart(2, '0')}.png`
  });
}

function parseError(errorMsg: string) { // Changed 'error' to 'errorMsg' to avoid conflict
  const regex = /{"error":(.*)}/gm;
  const m = regex.exec(errorMsg);
  try {
    const e = m[1];
    const err = JSON.parse(e);
    return err.message;
  } catch (e) {
    return errorMsg;
  }
}

async function generate(message: string) {
  userInput.disabled = true;
  downloadZipButton.toggleAttribute('hidden', true); // Hide button during generation

  slidesDataForExport = []; // Reset data for new generation
  chat.history.length = 0;
  modelOutput.innerHTML = '';
  slideshow.innerHTML = '';
  error.innerHTML = '';
  error.toggleAttribute('hidden', true);

  let slideCount = 0; // To keep track of slide numbers for filenames

  try {
    const userTurn = document.createElement('div') as HTMLDivElement;
    userTurn.innerHTML = await marked.parse(message);
    userTurn.className = 'user-turn';
    modelOutput.append(userTurn);
    userInput.value = '';

    const result = await chat.sendMessageStream({
      message: message + additionalInstructions,
    });

    let text = '';
    let imgElement: HTMLImageElement | null = null;

    for await (const chunk of result) {
      for (const candidate of chunk.candidates) {
        for (const part of candidate.content.parts ?? []) {
          if (part.text) {
            text += part.text;
          } else {
            try {
              const data = part.inlineData;
              if (data) {
                imgElement = document.createElement('img');
                imgElement.src = `data:image/png;base64,` + data.data;
              } else {
                console.log('no image data in part', part);
              }
            } catch (e) {
              console.log('error processing image data', e, part);
            }
          }
          if (text && imgElement) {
            await addSlide(text, imgElement, slideCount);
            slideCount++;
            slideshow.removeAttribute('hidden');
            if (slidesDataForExport.length > 0) {
                downloadZipButton.removeAttribute('hidden'); // Show button once there's data
            }
            text = '';
            imgElement = null;
          }
        }
      }
    }
    // Handle any remaining text/image if model ends stream unusually
    if (imgElement && text) {
      await addSlide(text, imgElement, slideCount);
      slideshow.removeAttribute('hidden');
       if (slidesDataForExport.length > 0) {
          downloadZipButton.removeAttribute('hidden');
      }
    } else if (text && !imgElement) {
        console.log("Leftover text without an image at the end:", text);
    }


  } catch (e: any) { // Explicitly type e as any or unknown then check
    const msg = parseError(e.message || String(e));
    error.innerHTML = `Something went wrong: ${msg}`;
    error.removeAttribute('hidden');
  }
  userInput.disabled = false;
  userInput.focus();
}

userInput.addEventListener('keydown', async (e: KeyboardEvent) => {
  if (e.code === 'Enter') {
    e.preventDefault();
    const message = userInput.value;
    if (message.trim() === '') return;
    await generate(message);
  }
});

const examples = document.querySelectorAll('#examples li');
examples.forEach((li) =>
  li.addEventListener('click', async (e) => {
    const textContent = li.textContent;
    if (textContent && textContent.trim() !== '') {
        await generate(textContent);
    }
  }),
);

// --- START OF NEW FUNCTION AND EVENT LISTENER ---
async function exportSlidesToZip() {
  if (slidesDataForExport.length === 0) {
    alert("No slides to export!");
    return;
  }

  const zip = new JSZip();
  let captionsContent = "# Slide Captions and Image Order\n\n";

  slidesDataForExport.forEach((slideData, index) => {
    // Add image to zip
    // The imageDataUrl is 'data:image/png;base64,BASE64_STRING_HERE'
    // We need to extract just the BASE64_STRING_HERE part for JSZip
    const base64Data = slideData.imageDataUrl.split(',')[1];
    zip.file(slideData.imageName, base64Data, {base64: true});

    // Add caption to the captions file
    captionsContent += `## ${slideData.imageName}\n`;
    captionsContent += `${slideData.text}\n\n`;
  });

  zip.file("captions.md", captionsContent); // Add the markdown file with all captions

  try {
    const zipBlob = await zip.generateAsync({type: "blob"});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = "cat_slides_presentation.zip";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href); // Clean up
  } catch (e) {
    console.error("Error generating ZIP file:", e);
    error.innerHTML = "Error generating ZIP file. Check console for details.";
    error.removeAttribute('hidden');
  }
}

downloadZipButton.addEventListener('click', exportSlidesToZip);
// --- END OF NEW FUNCTION AND EVENT LISTENER ---