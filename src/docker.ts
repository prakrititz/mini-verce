import Docker from 'dockerode';
import tar from 'tar-fs';
import path from 'path';

const docker = new Docker();

export async function buildImage(projectPath: string, imageName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Packing directory ${projectPath}...`);
    const pack = tar.pack(projectPath);
    
    console.log(`Building Docker image ${imageName}...`);
    docker.buildImage(pack, { t: imageName }, (err: any, stream: any) => {
      if (err) return reject(err);
      
      docker.modem.followProgress(
        stream,
        (onFinishedErr, output) => {
          if (onFinishedErr) reject(onFinishedErr);
          else resolve();
        },
        (event) => {
          if (event.stream) {
            process.stdout.write(event.stream);
          }
        }
      );
    });
  });
}

export async function startContainer(imageName: string, port: number, containerName: string): Promise<string> {
  const container = await docker.createContainer({
    Image: imageName,
    name: containerName,
    HostConfig: {
      PortBindings: {
        '80/tcp': [{ HostPort: port.toString() }],
        '3000/tcp': [{ HostPort: port.toString() }],
        '8080/tcp': [{ HostPort: port.toString() }]
      }
    }
  });

  await container.start();
  return container.id;
}

export async function stopContainer(containerId: string): Promise<void> {
  try {
    const container = docker.getContainer(containerId);
    await container.stop();
    await container.remove();
  } catch (err: any) {
    if (err.statusCode !== 404) {
      console.error(`Failed to stop container ${containerId}:`, err);
    }
  }
}
