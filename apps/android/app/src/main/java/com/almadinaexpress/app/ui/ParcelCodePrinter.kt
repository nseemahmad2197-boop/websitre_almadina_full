package com.almadinaexpress.app.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Bundle
import android.os.CancellationSignal
import android.os.OperationCanceledException
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.print.pdf.PrintedPdfDocument
import java.io.FileOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import kotlin.math.min

/** Prints only the supplied, already reserved codes; it never generates parcel numbers. */
fun printParcelCodes(context: Context, codes: List<String>, batchLabel: String) {
    require(codes.size in 1..500) { "يمكن طباعة من كود واحد إلى 500 كود في الدفعة." }
    require(codes.all { it.isNotBlank() }) { "تحتوي الدفعة على كود فارغ." }
    val printManager = context.getSystemService(Context.PRINT_SERVICE) as? PrintManager
        ?: error("خدمة الطباعة غير متاحة على هذا الجهاز.")
    val label = batchLabel.trim().take(80).ifBlank { "أكواد الطرود" }
    printManager.print(
        label,
        ParcelCodePrintAdapter(context.applicationContext, codes.toList(), label),
        PrintAttributes.Builder()
            .setMediaSize(PrintAttributes.MediaSize.ISO_A4.asPortrait())
            .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
            .setMinMargins(PrintAttributes.Margins(180, 180, 180, 180))
            .build(),
    )
}

private class ParcelCodePrintAdapter(
    private val context: Context,
    private val codes: List<String>,
    private val label: String,
) : PrintDocumentAdapter() {
    private val pageCount = (codes.size + LABELS_PER_PAGE - 1) / LABELS_PER_PAGE
    private val worker = Executors.newSingleThreadExecutor()
    private var attributes: PrintAttributes? = null

    override fun onLayout(
        oldAttributes: PrintAttributes?,
        newAttributes: PrintAttributes,
        cancellationSignal: CancellationSignal,
        callback: LayoutResultCallback,
        extras: Bundle?,
    ) {
        if (cancellationSignal.isCanceled) {
            callback.onLayoutCancelled()
            return
        }
        attributes = newAttributes
        callback.onLayoutFinished(
            PrintDocumentInfo.Builder("$label.pdf")
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .setPageCount(pageCount)
                .build(),
            oldAttributes != newAttributes,
        )
    }

    override fun onWrite(
        pages: Array<out PageRange>,
        destination: ParcelFileDescriptor,
        cancellationSignal: CancellationSignal,
        callback: WriteResultCallback,
    ) {
        val currentAttributes = attributes
        if (currentAttributes == null) {
            callback.onWriteFailed("تعذّر تجهيز صفحات الطباعة. حاول مرة أخرى.")
            return
        }
        // PageRange uses zero-based indices in the original document, even when
        // only a subset of its pages is written to the destination PDF.
        val selectedPages = (0 until pageCount).filter { index ->
            pages.any { index >= it.start && index <= it.end }
        }
        if (selectedPages.isEmpty()) {
            callback.onWriteFailed("لم يتم اختيار صفحات صالحة للطباعة.")
            return
        }
        try {
            worker.execute {
                try {
                    checkCancellation(cancellationSignal)
                    val document = PrintedPdfDocument(context, currentAttributes)
                    try {
                        for (pageIndex in selectedPages) {
                            checkCancellation(cancellationSignal)
                            val page = document.startPage(pageIndex)
                            try {
                                val area = RectF(page.info.contentRect)
                                drawPage(page.canvas, area, pageIndex, cancellationSignal)
                            } finally {
                                document.finishPage(page)
                            }
                        }
                        checkCancellation(cancellationSignal)
                        FileOutputStream(destination.fileDescriptor).use { output ->
                            document.writeTo(output)
                        }
                        checkCancellation(cancellationSignal)
                    } finally {
                        document.close()
                    }
                    callback.onWriteFinished(mergedPageRanges(selectedPages))
                } catch (_: OperationCanceledException) {
                    callback.onWriteCancelled()
                } catch (_: Exception) {
                    if (cancellationSignal.isCanceled || Thread.currentThread().isInterrupted) {
                        callback.onWriteCancelled()
                    } else {
                        callback.onWriteFailed("تعذّرت طباعة الأكواد. تحقق من خدمة الطباعة وحاول مجددًا.")
                    }
                }
            }
        } catch (_: RejectedExecutionException) {
            callback.onWriteCancelled()
        }
    }

    override fun onFinish() {
        worker.shutdownNow()
        super.onFinish()
    }

    private fun drawPage(
        canvas: Canvas,
        area: RectF,
        pageIndex: Int,
        cancellationSignal: CancellationSignal,
    ) {
        require(area.width() > 0 && area.height() > 0) { "Invalid print area" }
        canvas.drawColor(Color.WHITE)
        val cellWidth = area.width() / COLUMNS
        val cellHeight = area.height() / ROWS
        val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.LTGRAY
            style = Paint.Style.STROKE
            strokeWidth = 0.5f
        }
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textAlign = Paint.Align.CENTER
        }
        val bitmapPaint = Paint().apply { isFilterBitmap = false }
        for (position in 0 until LABELS_PER_PAGE) {
            val code = codes.getOrNull(pageIndex * LABELS_PER_PAGE + position) ?: break
            checkCancellation(cancellationSignal)
            val bounds = RectF(
                area.left + position % COLUMNS * cellWidth + 3f,
                area.top + position / COLUMNS * cellHeight + 3f,
                area.left + (position % COLUMNS + 1) * cellWidth - 3f,
                area.top + (position / COLUMNS + 1) * cellHeight - 3f,
            )
            canvas.drawRect(bounds, borderPaint)
            textPaint.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
            textPaint.textSize = 7f
            canvas.drawText("ALMADINA EXPRESS", bounds.centerX(), bounds.top + 10f, textPaint)

            val qrSide = min(bounds.width() - 12f, bounds.height() - 29f)
            require(qrSide > 0) { "Print area is too small" }
            val qrBounds = RectF(
                bounds.centerX() - qrSide / 2f,
                bounds.top + 12f,
                bounds.centerX() + qrSide / 2f,
                bounds.top + 12f + qrSide,
            )
            val bitmap = createQrBitmap(code, 512)
            try {
                canvas.drawBitmap(bitmap, null, qrBounds, bitmapPaint)
            } finally {
                bitmap.recycle()
            }
            textPaint.typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            textPaint.textSize = 10f
            val codeWidth = textPaint.measureText(code)
            if (codeWidth > bounds.width() - 12f) {
                textPaint.textSize *= (bounds.width() - 12f) / codeWidth
            }
            canvas.drawText(code, bounds.centerX(), bounds.bottom - 5f, textPaint)
        }
    }

    private fun checkCancellation(signal: CancellationSignal) {
        signal.throwIfCanceled()
        if (Thread.currentThread().isInterrupted) throw OperationCanceledException()
    }

    private fun mergedPageRanges(pages: List<Int>): Array<PageRange> {
        val ranges = mutableListOf<PageRange>()
        var start = pages.first()
        var end = start
        for (page in pages.drop(1)) {
            if (page == end + 1) {
                end = page
            } else {
                ranges += PageRange(start, end)
                start = page
                end = page
            }
        }
        ranges += PageRange(start, end)
        return ranges.toTypedArray()
    }

    private companion object {
        const val COLUMNS = 3
        const val ROWS = 8
        const val LABELS_PER_PAGE = COLUMNS * ROWS
    }
}
