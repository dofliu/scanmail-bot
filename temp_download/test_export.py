import urllib.request
import torch
import torch.nn as nn
import torch.nn.functional as F
import cv2
import os

# Define blocks.py classes
class ConvBlock(nn.Module):
    def __init__(self, in_channels, out_channels, mid_channels=None):
        super().__init__()
        if not mid_channels:
            mid_channels = out_channels
        self.conv = nn.Sequential(
            nn.Conv2d(in_channels, mid_channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(mid_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(mid_channels, out_channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True)
        )
    def forward(self, dataIn):
        return self.conv(dataIn)

class Down(nn.Module):
    def __init__(self, in_channels, out_channels) -> None:
        super().__init__()
        self.pool = nn.Sequential(
            nn.MaxPool2d(kernel_size=2),
            ConvBlock(in_channels, out_channels)
        )
    def forward(self, dataIn):
        return self.pool(dataIn)

class Up(nn.Module):
    def __init__(self, in_channels, out_channels):
        super().__init__()
        self.up = nn.ConvTranspose2d(in_channels, in_channels//2, kernel_size=2, stride=2)
        self.conv = ConvBlock(in_channels, out_channels)
    def forward(self, dataIn, skipIn):
        upsampled = self.up(dataIn)
        diffY = skipIn.size()[2] - upsampled.size()[2]
        diffX = skipIn.size()[3] - upsampled.size()[3]
        upsampled = F.pad(upsampled, [diffY//2, diffY-diffX // 2, diffY//2, diffY-diffX // 2])
        out = torch.cat([skipIn, upsampled], dim=1)
        return self.conv(out)

class Out(nn.Module):
    def __init__(self, in_channels, out_channels):
        super().__init__()
        self.conv = nn.Conv2d(in_channels, out_channels, kernel_size=1)
    def forward(self, dataIn):
        return self.conv(dataIn)

# Define UNet.py class
class UNet(nn.Module):
    def __init__(self, n_channels, n_classes, n_blocks=4, start=32):
        super(UNet, self).__init__()
        self.n_blocks = n_blocks
        self.n_classes = n_classes
        self.start = start
        self.layers = nn.Sequential(
            ConvBlock(n_channels, start),
            *self.get_blocks(start),
            Out(start, n_classes)
        )
    def forward(self, dataIn):
        num_layers = len(self.layers)
        outs = [dataIn]
        for i in range(0, self.n_blocks+1):
            outs.append(self.layers[i].forward(outs[-1]))
        out = outs.pop()
        for i in range(self.n_blocks+1, num_layers-1):
            out = self.layers[i].forward(out, outs.pop())
        logits = self.layers[-1].forward(out)
        return logits
    def get_blocks(self, start):
        blocks = []
        for i in range(self.n_blocks):
            start_mult = start * 2 ** i
            blocks.append(Down(start_mult, start_mult * 2))
        for i in range(self.n_blocks-1, -1, -1):
            start_mult = start * 2 ** i
            blocks.append(Up(start_mult * 2, start_mult))
        return blocks

def test(model_name):
    pth_file = f'temp_download/{model_name}.pth'
    if not os.path.exists(pth_file):
        print(f"Downloading {model_name}.pth...")
        urllib.request.urlretrieve(f'https://huggingface.co/Lingram/DocuSegment-Pytorch/resolve/main/{model_name}.pth', pth_file)
    
    print(f"Loading {model_name} weights...")
    ckpt = torch.load(pth_file, map_location='cpu')
    print("Checkpoint keys:", ckpt.keys())
    print("n_blocks:", ckpt.get("n_blocks"))
    print("n_classes:", ckpt.get("n_classes"))
    print("start_channels:", ckpt.get("start_channels"))
    
    n_blocks = ckpt.get("n_blocks", 4)
    n_classes = ckpt.get("n_classes", 1)
    start_channels = ckpt.get("start_channels", 32)
    
    model = UNet(n_channels=3, n_classes=n_classes, n_blocks=n_blocks, start=start_channels)
    model.load_state_dict(ckpt['state_dict'])
    model.eval()

    onnx_file = f'temp_download/{model_name}.onnx'
    print("Exporting to ONNX...")
    dummy_input = torch.randn(1, 3, 256, 256)
    torch.onnx.export(model, dummy_input, onnx_file, input_names=['input'], output_names=['output'])

    print("Loading in OpenCV DNN...")
    net = cv2.dnn.readNetFromONNX(onnx_file)
    print("OpenCV DNN loaded successfully!", net)

if __name__ == '__main__':
    print("=== Testing unet_16 ===")
    test('unet_16')
    print("\n=== Testing unet_32 ===")
    test('unet_32')
