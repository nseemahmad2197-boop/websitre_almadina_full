import SwiftUI
import AVFoundation
import CoreImage.CIFilterBuiltins

enum QRCode {
    static func image(_ value: String) -> UIImage? {
        guard !value.isEmpty else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(value.utf8); filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        guard let image = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: image)
    }
}

struct QRImage: View {
    let value: String
    var body: some View {
        if let image = QRCode.image(value) {
            Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
                .padding(20).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 18))
                .frame(maxWidth: 300).accessibilityLabel("رمز QR: " + value)
        }
    }
}

struct ScannerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    var onCode: (String) -> Void
    var body: some View {
        NavigationStack {
            CameraScanner { code in dismiss(); onCode(code) }
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("إلغاء") { dismiss() } } }
        }.environment(\.layoutDirection, .rightToLeft)
    }
}

struct CameraScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Void
    func makeUIViewController(context: Context) -> ScannerController { ScannerController(onCode: onCode) }
    func updateUIViewController(_ uiViewController: ScannerController, context: Context) {}
    static func dismantleUIViewController(_ controller: ScannerController, coordinator: ()) { controller.stop() }
}

final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let capture = AVCaptureSession()
    private let queue = DispatchQueue(label: "com.almadinaexpress.camera")
    private var preview: AVCaptureVideoPreviewLayer?
    private var finished = false
    private var visible = false
    private var requestingPermission = false
    private var errorView: UIView?
    private let onCode: (String) -> Void
    init(onCode: @escaping (String) -> Void) { self.onCode = onCode; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .black
        NotificationCenter.default.addObserver(self, selector: #selector(resumeCamera), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(pauseCamera), name: UIApplication.willResignActiveNotification, object: nil)
    }
    deinit { NotificationCenter.default.removeObserver(self) }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated); visible = true
        checkCameraPermission(allowPrompt: true)
    }
    @objc private func resumeCamera() { checkCameraPermission(allowPrompt: false) }
    @objc private func pauseCamera() {
        queue.async { [capture] in if capture.isRunning { capture.stopRunning() } }
    }
    private func checkCameraPermission(allowPrompt: Bool) {
        guard visible, !finished, UIApplication.shared.applicationState == .active else { return }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: configure()
        case .notDetermined:
            guard allowPrompt, !requestingPermission else { return }
            requestingPermission = true
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.requestingPermission = false
                    if granted { self.checkCameraPermission(allowPrompt: false) }
                    else { self.showError("اسمح باستخدام الكاميرا من إعدادات الجهاز لقراءة الملصق.") }
                }
            }
        default:
            pauseCamera()
            showError("إذن الكاميرا غير مفعّل. يمكنك تفعيله من إعدادات الجهاز.")
        }
    }
    private func configure() {
        guard visible, !finished else { return }
        errorView?.removeFromSuperview(); errorView = nil
        if preview != nil {
            queue.async { [capture] in if !capture.isRunning { capture.startRunning() } }
            return
        }
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) ?? AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: camera) else {
            showError("الكاميرا غير متاحة. جرّب التطبيق على جهاز فعلي مزوّد بكاميرا."); return
        }
        let output = AVCaptureMetadataOutput()
        guard capture.canAddInput(input), capture.canAddOutput(output) else { showError("تعذّر تجهيز قارئ QR."); return }
        capture.addInput(input); capture.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr, .code128].filter { output.availableMetadataObjectTypes.contains($0) }
        let layer = AVCaptureVideoPreviewLayer(session: capture); layer.videoGravity = .resizeAspectFill
        view.layer.insertSublayer(layer, at: 0); preview = layer
        view.setNeedsLayout()
        let label = UILabel(); label.text = "وجّه الكاميرا إلى رمز QR على الملصق"; label.textColor = .white
        label.backgroundColor = UIColor.black.withAlphaComponent(0.65); label.textAlignment = .center
        label.font = .preferredFont(forTextStyle: .headline); label.adjustsFontForContentSizeCategory = true; label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(label)
        NSLayoutConstraint.activate([label.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20), label.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20), label.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24)])
        queue.async { [capture] in capture.startRunning() }
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews(); preview?.frame = view.bounds
        if let orientation = view.window?.windowScene?.interfaceOrientation, let connection = preview?.connection, connection.isVideoOrientationSupported {
            switch orientation {
            case .landscapeLeft: connection.videoOrientation = .landscapeLeft
            case .landscapeRight: connection.videoOrientation = .landscapeRight
            case .portraitUpsideDown: connection.videoOrientation = .portraitUpsideDown
            default: connection.videoOrientation = .portrait
            }
        }
    }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); stop() }
    func stop() { visible = false; pauseCamera() }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard visible, !finished, let code = objects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first, !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        finished = true; stop(); UINotificationFeedbackGenerator().notificationOccurred(.success); onCode(code)
    }
    private func showError(_ message: String) {
        guard visible else { return }
        errorView?.removeFromSuperview()
        let label = UILabel(); label.text = message; label.numberOfLines = 0; label.textAlignment = .center
        label.textColor = .white; label.font = .preferredFont(forTextStyle: .body); label.adjustsFontForContentSizeCategory = true
        let settings = UIButton(type: .system); settings.setTitle("فتح الإعدادات", for: .normal)
        settings.addTarget(self, action: #selector(openSettings), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [label, settings]); stack.axis = .vertical; stack.spacing = 18
        errorView = stack
        stack.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(stack)
        NSLayoutConstraint.activate([stack.centerYAnchor.constraint(equalTo: view.centerYAnchor), stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24), stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24)])
    }
    @objc private func openSettings() { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
}
