import Docker from 'dockerode';
import tar from 'tar-fs';
import path from 'path';

const docker = new Docker();

export async function buildImage(projectPath: string, imageName: string, buildargs?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Packing directory ${projectPath}...`);
    const pack = tar.pack(projectPath);
    
    console.log(`Building Docker image ${imageName}...`);
    const buildOptions: any = { t: imageName };
    if (buildargs && Object.keys(buildargs).length > 0) {
      buildOptions.buildargs = buildargs;
    }
    
    docker.buildImage(pack, buildOptions, (err: any, stream: any) => {
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

export async function startContainer(imageName: string, port: number, containerName: string, env?: string[], exposedPort: number = 3000): Promise<string> {
  const container = await docker.createContainer({
    Image: imageName,
    name: containerName,
    Env: env || [],
    HostConfig: {
      PortBindings: {
        [`${exposedPort}/tcp`]: [{ HostPort: port.toString() }]
      }
    }
  });

  await container.start();
  return container.id;
}

export async function stopContainer(containerId: string, remove: boolean = true): Promise<void> {
  try {
    const container = docker.getContainer(containerId);
    try {
      await container.stop();
    } catch (err: any) {
      if (err.statusCode !== 304) throw err; // 304 is already stopped
    }
    if (remove) {
      await container.remove();
    }
  } catch (err: any) {
    if (err.statusCode !== 404) {
      console.error(`Failed to stop/remove container ${containerId}:`, err);
    }
  }
}

export async function printContainerLogs(containerId: string, follow: boolean = false): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const container = docker.getContainer(containerId);
      const stream = await container.logs({
        stdout: true,
        stderr: true,
        tail: 100,
        follow
      } as any);

      if (follow) {
        docker.modem.demuxStream(stream as any, process.stdout, process.stderr);
        (stream as any).on('end', () => resolve());
        (stream as any).on('error', (err: any) => reject(err));
      } else {
        // When follow is false, stream is usually a Buffer
        process.stdout.write(stream as any);
        resolve();
      }
    } catch (err) {
      reject(err);
    }
  });
}
